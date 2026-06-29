/**
 * AI-assisted self-healing locator engine.
 *
 * WHAT IT DOES:
 *   When the primary `data-testid` no longer resolves to exactly one element —
 *   because an AI refactor renamed/retagged it — the engine resolves the element
 *   from a bundle of secondary *signals* (ARIA role, accessible name, visible
 *   text, structural CSS, attributes) and records the heal in an audit trail.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - It NEVER substitutes for an assertion. Healing resolves *where* an element
 *     is, never *whether a business outcome happened*. Verifications use stable
 *     test ids + real expect()s, so a genuine regression still fails.
 *   - It NEVER "skips" a step. If it cannot find a confident, UNIQUE match it
 *     throws — a missing element is treated as a real defect, not healed away.
 *   - Heals are logged and require a follow-up MR to make permanent; they are a
 *     safety net during AI-driven churn, not a way to hide selector rot.
 *
 * FAILURE CATEGORIES HANDLED (with realistic success rates — see docs/adr/0003):
 *   testid rename ............ ~95%   (role+name or attributes recover it)
 *   tag/element swap ......... ~90%   (role+name unaffected by tag)
 *   text/label tweak ......... ~70%   (role survives; large text changes do not)
 *   DOM reparent/move ........ ~85%   (signals are not position-dependent)
 *   genuine removal .......... 0% by design — surfaced as a failure, never healed
 */
import { Locator, Page } from '@playwright/test';
import { recordHeal } from './healing-audit';

export interface ElementDescriptor {
  /** Logical, stable name for audit/readability, e.g. "login.submit". */
  id: string;
  /** Preferred selector: data-testid value. OPTIONAL — omit it (or set selectorMode
   * 'semantic') to drive everything from the accessibility tree with zero app changes. */
  testId?: string;
  /** Critical business step — failure to resolve must never be swallowed. */
  critical?: boolean;
  /** Semantic signals. In semantic mode these are the PRIMARY locators. */
  role?: Parameters<Page['getByRole']>[0];
  name?: string | RegExp;
  text?: string;
  attributes?: Record<string, string>;
  css?: string;
}

interface Candidate {
  strategy: string;
  description: string;
  baseConfidence: number;
  locator: Locator;
}

const MIN_CONFIDENCE = 0.6;

function buildCandidates(page: Page, d: ElementDescriptor): Candidate[] {
  const c: Candidate[] = [];
  if (d.role && d.name != null) {
    c.push({
      strategy: 'role+name',
      description: `getByRole('${d.role}', { name: ${String(d.name)} })`,
      baseConfidence: 0.92,
      locator: page.getByRole(d.role, { name: d.name }),
    });
  }
  if (d.attributes && Object.keys(d.attributes).length) {
    const sel = Object.entries(d.attributes).map(([k, v]) => `[${k}="${v}"]`).join('');
    c.push({ strategy: 'attributes', description: sel, baseConfidence: 0.8, locator: page.locator(sel) });
  }
  if (d.role && d.text) {
    c.push({
      strategy: 'role+text',
      description: `getByRole('${d.role}', { name: /${d.text}/ })`,
      baseConfidence: 0.82,
      locator: page.getByRole(d.role, { name: new RegExp(escapeRe(d.text), 'i') }),
    });
  } else if (d.text) {
    c.push({ strategy: 'text', description: `getByText(/${d.text}/i)`, baseConfidence: 0.75, locator: page.getByText(new RegExp(escapeRe(d.text), 'i')) });
  }
  if (d.css) {
    c.push({ strategy: 'css', description: d.css, baseConfidence: 0.6, locator: page.locator(d.css) });
  }
  return c;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Resolve a descriptor to a single Locator, healing if the primary selector has
 * drifted. `testName` is recorded in the audit trail.
 */
export async function resolve(page: Page, d: ElementDescriptor, testName: string): Promise<Locator> {
  // Mode decides what the PRIMARY locator is. 'semantic' (or a descriptor with no
  // testId) leads with the accessibility tree, so the app needs no data-testid at
  // all. 'testid' (default) leads with data-testid and heals via semantics.
  const mode = process.env.SELECTOR_MODE === 'semantic' ? 'semantic' : 'testid';
  const semanticFirst = mode === 'semantic' || !d.testId;

  const testIdCand: Candidate | null = d.testId
    ? { strategy: 'testid', description: `getByTestId('${d.testId}')`, baseConfidence: 0.97, locator: page.getByTestId(d.testId) }
    : null;
  const signalCands = buildCandidates(page, d);

  // Ordered list: primary first, then fallbacks.
  const ordered: Candidate[] = (semanticFirst ? [...signalCands, testIdCand] : [testIdCand, ...signalCands])
    .filter((c): c is Candidate => !!c);

  if (ordered.length === 0) {
    throw new Error(`[self-healing] '${d.id}' has no locatable signals (no testId, role/name, text, attributes or css).`);
  }

  const [primary, ...fallbacks] = ordered;

  // Healthy path: the primary resolves uniquely — return it, no audit noise.
  let primaryCount = 0;
  try { primaryCount = await primary.locator.count(); } catch { primaryCount = 0; }
  if (primaryCount === 1) return primary.locator;

  // Primary missing/ambiguous: try fallbacks; a unique match is a recorded heal.
  let best: { cand: Candidate; confidence: number } | null = null;
  for (const cand of fallbacks) {
    let count = 0;
    try { count = await cand.locator.count(); } catch { count = 0; }
    if (count !== 1) continue; // ambiguity is not a heal
    if (cand.baseConfidence >= MIN_CONFIDENCE && (!best || cand.baseConfidence > best.confidence)) {
      best = { cand, confidence: cand.baseConfidence };
    }
  }

  const url = page.url();
  if (best) {
    recordHeal({
      ts: new Date().toISOString(), test: testName, elementId: d.id, critical: !!d.critical,
      outcome: 'healed', primarySelector: primary.description,
      healedStrategy: best.cand.strategy, healedSelector: best.cand.description, confidence: best.confidence,
      candidatesConsidered: ordered.length, url,
      note: primaryCount === 0 ? `primary (${primary.strategy}) resolved 0 elements` : `primary (${primary.strategy}) ambiguous (${primaryCount} matches)`,
    });
    return best.cand.locator;
  }

  // No confident, unique recovery — a REAL problem, never silently skipped.
  recordHeal({
    ts: new Date().toISOString(), test: testName, elementId: d.id, critical: !!d.critical,
    outcome: 'heal_failed', primarySelector: primary.description, candidatesConsidered: ordered.length, url,
    note: `could not resolve '${d.id}' by ${mode}-primary or any fallback — surfacing as failure (no silent skip)`,
  });
  throw new Error(
    `[self-healing] Could not locate '${d.id}' (mode=${mode}, primary=${primary.description}). ` +
    `${ordered.length} candidate(s) tried, none uniquely resolved. Reported as a real failure — healing never skips a step.`
  );
}
