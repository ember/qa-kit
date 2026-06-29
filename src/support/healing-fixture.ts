/**
 * Ambient self-healing fixture — `import { test, expect } from '../support/healing-fixture'`
 * (replacing your `@playwright/test` import) is the ONLY change an existing spec
 * needs. The returned `page` wraps Playwright's locator factories so that:
 *
 *   - on a GREEN action, it records the resolved element's fingerprint
 *     (role/name/text) to the learned baseline, keyed by the locator call;
 *   - on a MISS (the selector drifted), it recovers the element from that stored
 *     fingerprint via the accessibility tree, performs the action, and logs the
 *     heal — so your unchanged `getByTestId(...)` / `locator(...)` calls keep working.
 *
 * Guardrails: only locator DRIFT is healed. If nothing resolves and no
 * confident fingerprint match exists, the action runs on the original locator and
 * fails — a real regression is never hidden. Healing covers ACTIONS; assertions use
 * the raw locator, so a genuinely-missing element still fails an expect().
 */
import { test as base, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { recordFingerprint, getFingerprint, saveBaseline, Fingerprint } from './selector-baseline';
import { recordHeal } from './healing-audit';

const FACTORIES = ['getByTestId', 'getByRole', 'getByLabel', 'getByText', 'getByPlaceholder', 'getByTitle', 'getByAltText', 'locator'];
const ACTIONS = ['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'focus', 'tap', 'setInputFiles', 'clear'];

function keyFor(method: string, args: any[]): string {
  if (method === 'getByRole') return `role:${args[0]}:${(args[1] && args[1].name) || ''}`;
  return `${method}:${String(args[0])}`;
}

async function fingerprint(loc: Locator): Promise<Fingerprint | null> {
  try {
    return await loc.evaluate((el: any) => {
      const tag = el.tagName.toLowerCase();
      const roleMap: Record<string, string> = {
        button: 'button', a: 'link', select: 'combobox', textarea: 'textbox',
        h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
      };
      let role = el.getAttribute('role') || roleMap[tag] || '';
      if (tag === 'input') role = el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox';
      const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      return { role, name, text: name, tag };
    });
  } catch { return null; }
}

function candidatesFromFingerprint(page: Page, fp: Fingerprint): { strategy: string; locator: Locator }[] {
  const c: { strategy: string; locator: Locator }[] = [];
  if (fp.role && fp.name) c.push({ strategy: 'learned:role+name', locator: page.getByRole(fp.role as any, { name: fp.name }) });
  if (fp.name) c.push({ strategy: 'learned:text', locator: page.getByText(fp.name, { exact: false }) });
  return c;
}

async function resolveTarget(page: Page, base: Locator, key: string, testName: string): Promise<Locator> {
  let n = 0;
  try { n = await base.count(); } catch { n = 0; }

  if (n === 1) {
    const fp = await fingerprint(base); // learn on the green path
    if (fp) recordFingerprint(key, fp);
    return base;
  }

  if (n === 0) {
    const fp = getFingerprint(key);
    if (fp) {
      for (const cand of candidatesFromFingerprint(page, fp)) {
        let cn = 0;
        try { cn = await cand.locator.count(); } catch { cn = 0; }
        if (cn === 1) {
          recordHeal({
            ts: new Date().toISOString(), test: testName, elementId: key, critical: false,
            outcome: 'healed', primarySelector: key, healedStrategy: cand.strategy,
            healedSelector: `${fp.role || ''} "${fp.name}"`, confidence: cand.strategy.includes('role') ? 0.9 : 0.75,
            candidatesConsidered: 2, url: page.url(), note: 'recovered from learned baseline fingerprint',
          });
          return cand.locator;
        }
      }
      recordHeal({
        ts: new Date().toISOString(), test: testName, elementId: key, critical: false,
        outcome: 'heal_failed', primarySelector: key, candidatesConsidered: 2, url: page.url(),
        note: 'baseline fingerprint present but no unique match — surfacing as real failure',
      });
    }
  }
  // n>1 (ambiguous) or no recovery: act on the original — its real error surfaces.
  return base;
}

function wrapLocator(base: Locator, key: string, page: Page, testName: string): Locator {
  return new Proxy(base, {
    get(target, prop: string) {
      if (ACTIONS.includes(prop)) {
        return async (...a: any[]) => {
          const t = await resolveTarget(page, target, key, testName);
          return (t as any)[prop](...a);
        };
      }
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Locator;
}

function wrapPage(page: Page, testName: string): Page {
  return new Proxy(page, {
    get(target, prop: string) {
      if (FACTORIES.includes(prop)) {
        return (...args: any[]) => wrapLocator((target as any)[prop](...args), keyFor(prop, args), target, testName);
      }
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Page;
}

// Generic, app-agnostic: extends plain @playwright/test and only wraps `page`.
// Any project can `import { test, expect } from '../support/healing-fixture'` with no
// coupling to the demo fixtures. (Provide your own auth/setup as usual.)
export const test = base.extend<{}>({
  page: async ({ page }, use, testInfo) => {
    await use(wrapPage(page, testInfo.title));
    saveBaseline(); // persist anything learned this test
  },
});

export { expect };
