'use strict';
/**
 * Exploratory agent. Walks the app's routes and surfaces *suggestions* — never
 * merge-gating tests. Per route it collects heuristic signals (HTTP >= 400,
 * console errors, missing <h1>/<main>, form controls with no accessible name) and
 * cross-references reached @flow:s against the flows covered by specs.
 *
 * App-agnostic: crawls the running app at WEB_BASE (the consumer's CI brings it
 * up — no bundled SUT). Routes come from QA_EXPLORE_ROUTES (JSON: [{path,flow}])
 * or default to ['/']. Optional LLM enrichment via the approved-model gate when
 * ANTHROPIC_API_KEY is set; heuristics-only otherwise. Always exits 0.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, REPORTS, listSpecFiles } = require('./reports');
const { generate, POLICY } = require('./test-gen/provider');

const WEB_BASE = process.env.WEB_BASE || 'http://localhost:3000';

function routes() {
  try { const r = JSON.parse(process.env.QA_EXPLORE_ROUTES || ''); if (Array.isArray(r) && r.length) return r; } catch { /* fall through */ }
  return [{ path: '/', flow: 'home' }];
}

function coveredFlows() {
  const flows = new Set();
  for (const f of listSpecFiles()) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(/@flow:([a-z-]+)/gi)) flows.add(m[1]);
  }
  return flows;
}

async function main() {
  let chromium;
  try { ({ chromium } = require('@playwright/test')); }
  catch { console.error('[explore] @playwright/test not resolvable from the project — skipping.'); return; }

  fs.mkdirSync(REPORTS, { recursive: true });
  const ROUTES = routes();
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: WEB_BASE });

  const findings = [];
  const flowsReached = new Set();
  for (const route of ROUTES) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    let status = null;
    try {
      const resp = await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      findings.push({ route: route.path, flow: route.flow, severity: 'error', signal: `navigation failed: ${String(e).slice(0, 120)}` });
      await page.close(); continue;
    }
    if (route.flow) flowsReached.add(route.flow);
    const a11y = await page.evaluate(() => {
      const hasH1 = !!document.querySelector('h1');
      const hasMain = !!document.querySelector('main, [role=main]');
      const controls = Array.from(document.querySelectorAll('input, select, textarea, button'));
      const unlabeled = controls.filter((el) => {
        const id = el.getAttribute('id');
        const labelled = id && document.querySelector(`label[for="${id}"]`);
        const text = (el.textContent || '').trim();
        return !el.getAttribute('aria-label') && !el.getAttribute('title') && !labelled && !(el.tagName === 'BUTTON' && text);
      }).length;
      return { hasH1, hasMain, unlabeled };
    });
    if (status && status >= 400) findings.push({ route: route.path, flow: route.flow, severity: 'high', signal: `HTTP ${status} on navigation` });
    if (consoleErrors.length) findings.push({ route: route.path, flow: route.flow, severity: 'medium', signal: `${consoleErrors.length} console error(s): ${consoleErrors[0].slice(0, 100)}` });
    if (!a11y.hasH1) findings.push({ route: route.path, flow: route.flow, severity: 'low', signal: 'no <h1> heading' });
    if (!a11y.hasMain) findings.push({ route: route.path, flow: route.flow, severity: 'low', signal: 'no <main> / role=main landmark' });
    if (a11y.unlabeled > 0) findings.push({ route: route.path, flow: route.flow, severity: 'medium', signal: `${a11y.unlabeled} form control(s) without an accessible name` });
    await page.close();
  }
  await browser.close();

  const covered = coveredFlows();
  const uncoveredFlows = [...flowsReached].filter((f) => f && !covered.has(f));
  for (const f of uncoveredFlows) findings.push({ route: '(flow)', flow: f, severity: 'medium', signal: `flow reached by crawler but no spec carries @flow:${f}` });

  let llmSuggestions = null, llmNote = 'LLM enrichment skipped (no ANTHROPIC_API_KEY / no approved model) — heuristics only';
  try {
    const prompt = `You are a QA exploratory agent. Given these crawl findings (JSON), list up to 5 concrete, risky or uncovered states worth an E2E test. Be specific and terse.\n\n${JSON.stringify(findings).slice(0, 6000)}`;
    const out = await generate(prompt, {});
    if (out) { llmSuggestions = out; llmNote = `LLM enrichment via approved model ${POLICY.defaultModel}`; }
  } catch (e) { llmNote = `LLM enrichment refused/failed: ${String(e.message || e).slice(0, 160)}`; }

  const report = { generatedAt: new Date().toISOString(), target: WEB_BASE, routesVisited: ROUTES.length, findingCount: findings.length, uncoveredFlows, findings, llmNote, llmSuggestions };
  fs.writeFileSync(path.join(REPORTS, 'exploration.json'), JSON.stringify(report, null, 2));
  const md = ['# Exploratory findings (advisory — suggestions, not a gate)', '',
    `Generated: ${report.generatedAt}  ·  target: ${WEB_BASE}  ·  routes: ${ROUTES.length}  ·  findings: ${findings.length}`, '',
    '| Severity | Route | Flow | Signal |', '|---|---|---|---|',
    ...findings.map((f) => `| ${f.severity} | ${f.route} | ${f.flow || ''} | ${f.signal} |`), '',
    `**Uncovered flows reached:** ${uncoveredFlows.length ? uncoveredFlows.join(', ') : 'none'}`, '',
    `**AI enrichment:** ${llmNote}`, llmSuggestions ? `\n${llmSuggestions}\n` : '',
    '> Suggestions for a human to triage; nothing here blocks a merge.', ''].join('\n');
  fs.writeFileSync(path.join(REPORTS, 'exploration.md'), md);
  console.log(`[explore] ${findings.length} finding(s) across ${ROUTES.length} routes; ${uncoveredFlows.length} uncovered flow(s). ${llmNote}.`);
}

module.exports = { main };
if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error('[explore] non-fatal:', e); process.exit(0); });
