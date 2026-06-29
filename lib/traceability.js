'use strict';
/**
 * Traceability matrix builder. Joins the requirement registry against the
 * @req:<ID> tags in spec titles and the latest test outcomes, producing:
 *   - artifacts/reports/traceability.json  (machine, consumed by the summary)
 *   - docs/traceability-matrix.md          (human, part of the evidence pack)
 */
const fs = require('fs');
const path = require('path');
const { ROOT, REPORTS, loadRequirements, listSpecFiles, loadTestResults } = require('./reports');

function collectReqTags() {
  const map = {};
  for (const file of listSpecFiles()) {
    const txt = fs.readFileSync(file, 'utf8');
    // each test(...)/test.xxx(...) title (single or double quoted) and its @req tags
    for (const m of txt.matchAll(/\btest(?:\.\w+)?\(\s*['"]([^'"]*@req:[^'"]*)['"]/g)) {
      const title = m[1];
      for (const r of title.matchAll(/@req:([A-Z0-9-]+)/g)) {
        (map[r[1]] = map[r[1]] || []).push({ title, file: path.relative(ROOT, file) });
      }
    }
  }
  return map;
}

function statusFor(title, results) {
  const r = results.find((t) => t.title === title);
  return r ? r.status : 'not-run';
}

function build() {
  const requirements = loadRequirements();
  const tags = collectReqTags();
  const { tests } = loadTestResults();

  const rows = requirements.map((req) => {
    const covering = (tags[req.id] || []).map((t) => ({ ...t, status: statusFor(t.title, tests) }));
    return { ...req, tests: covering, covered: covering.length > 0, passing: covering.length > 0 && covering.every((t) => t.status === 'passed' || t.status === 'not-run') };
  });

  const total = rows.length;
  const covered = rows.filter((r) => r.covered).length;
  const essential = rows.filter((r) => r.essential);
  const essentialCovered = essential.filter((r) => r.covered).length;

  const byFlow = {};
  for (const r of rows) {
    byFlow[r.flow] = byFlow[r.flow] || { total: 0, covered: 0 };
    byFlow[r.flow].total++;
    if (r.covered) byFlow[r.flow].covered++;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    total, covered,
    coveragePct: total ? +((covered / total) * 100).toFixed(1) : 0,
    essentialTotal: essential.length, essentialCovered,
    essentialCoveragePct: essential.length ? +((essentialCovered / essential.length) * 100).toFixed(1) : 0,
    byFlow,
  };

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'traceability.json'), JSON.stringify({ summary, requirements: rows }, null, 2));

  const md = ['# Requirement Traceability Matrix', '', `_Generated ${summary.generatedAt}_`, '',
    `- **Requirement coverage:** ${covered}/${total} (${summary.coveragePct}%)`,
    `- **Essential business-flow coverage:** ${essentialCovered}/${essential.length} (${summary.essentialCoveragePct}%) — target: 100%`,
    '', '| Requirement | Flow | Risk | Essential | Covering tests | Status |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const t = r.tests.length ? r.tests.map((x) => `\`${x.title.replace(/@[^ ]+ /g, '').trim()}\``).join('<br>') : '— none —';
    const status = !r.covered ? '❌ uncovered' : r.passing ? '✅ passing' : '⚠️ failing';
    md.push(`| ${r.id} | ${r.flow} | ${r.risk} | ${r.essential ? 'yes' : 'no'} | ${t} | ${status} |`);
  }
  md.push('');
  const docsDir = path.join(ROOT, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'traceability-matrix.md'), md.join('\n'));

  console.log(`[traceability] ${covered}/${total} requirements covered (${summary.coveragePct}%); essential flows ${summary.essentialCoveragePct}%.`);
  const uncovered = rows.filter((r) => !r.covered);
  if (uncovered.length) console.log(`[traceability] UNCOVERED: ${uncovered.map((r) => r.id).join(', ')}`);
}

module.exports = { build };
if (require.main === module) build();
