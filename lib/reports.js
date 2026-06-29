'use strict';
/**
 * Shared helpers for the reporting tools (traceability, compliance, qa-summary).
 *
 * Path model: this code ships inside the qa-kit package but operates on
 * the CONSUMER project. ROOT is the consumer's project dir (QA_PROJECT_DIR, set by
 * the CLI, or process.cwd()); all conventional locations resolve under it and are
 * individually env-overridable.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.QA_PROJECT_DIR || process.cwd();
const REPORTS = process.env.QA_REPORTS_DIR || path.join(ROOT, 'artifacts/reports');
const REQUIREMENTS = process.env.QA_REQUIREMENTS || path.join(ROOT, 'tests/e2e/support/requirements.ts');
const E2E_DIR = process.env.QA_E2E_DIR || path.join(ROOT, 'tests/e2e');
const HEALING_AUDIT = process.env.QA_HEALING_AUDIT || path.join(ROOT, 'artifacts/healing-audit/healing.jsonl');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** Parse the requirement registry from its TS source (no ts runtime needed).
 *  Quote-agnostic ('…'/"…") and field-order-independent. */
function loadRequirements() {
  let src;
  try { src = fs.readFileSync(REQUIREMENTS, 'utf8'); } catch { return []; }
  const out = [];
  for (const m of src.matchAll(/\{[^{}]*\bid\s*:\s*['"]([^'"]+)['"][^{}]*\}/g)) {
    const obj = m[0];
    const str = (k) => { const r = obj.match(new RegExp('\\b' + k + '\\s*:\\s*[\'"]([^\'"]+)[\'"]')); return r ? r[1] : ''; };
    const bool = (k) => { const r = obj.match(new RegExp('\\b' + k + '\\s*:\\s*(true|false)')); return r ? r[1] === 'true' : false; };
    out.push({ id: m[1], flow: str('flow'), title: str('title'), essential: bool('essential'), risk: str('risk') });
  }
  return out;
}

/** Recursively list *.spec.ts under the e2e dir (handles flat or specs/ layouts). */
function listSpecFiles(dir = E2E_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listSpecFiles(p) : (e.name.endsWith('.spec.ts') ? [p] : []);
  });
}

/** Walk the Playwright JSON report into a flat list of { title, status, file, duration }. */
function loadTestResults() {
  const data = readJson(path.join(REPORTS, 'results.json'), null);
  const tests = [];
  if (!data) return { tests, stats: null };
  const walk = (suite, file) => {
    const f = suite.file || file;
    for (const spec of suite.specs || []) {
      const results = (spec.tests || []).flatMap((t) => t.results || []);
      const statuses = results.map((r) => r.status);
      const duration = results.reduce((a, r) => a + (r.duration || 0), 0);
      const ok = spec.ok === true;
      const allSkipped = statuses.length > 0 && statuses.every((s) => s === 'skipped');
      const status = allSkipped ? 'skipped' : ok ? 'passed' : (statuses.includes('failed') || statuses.includes('timedOut') ? 'failed' : 'unknown');
      tests.push({ title: spec.title, file: f, ok, status, duration });
    }
    for (const child of suite.suites || []) walk(child, f);
  };
  for (const s of data.suites || []) walk(s, s.file);
  return { tests, stats: data.stats || null };
}

/** Read the self-healing JSONL audit trail. */
function loadHealRecords() {
  try {
    return fs.readFileSync(HEALING_AUDIT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

module.exports = { ROOT, REPORTS, REQUIREMENTS, E2E_DIR, readJson, loadRequirements, listSpecFiles, loadTestResults, loadHealRecords };
