'use strict';
/**
 * Compliance-aware QA evidence pack generator. Structures QA evidence for internal
 * control reviews and audits (it organises the evidence; it provides no legal
 * interpretation): traceability, CI execution evidence, contract enforcement,
 * change-history/access-control structure, defect-remediation template, AI governance.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, REPORTS, readJson } = require('./reports');

const OUT_DIR = path.join(ROOT, 'docs/compliance');

function build() {
  const pw = readJson(path.join(REPORTS, 'results.json'), null);
  const stats = (pw && pw.stats) || {};
  const trace = readJson(path.join(REPORTS, 'traceability.json'), { summary: {}, requirements: [] });
  const flak = readJson(path.join(REPORTS, 'flakiness.json'), { flakinessIndex: 0, flaky: 0 });
  const contract = readJson(path.join(REPORTS, 'contract-diff.json'), { breakingCount: 0, mode: 'n/a' });
  const aiPolicy = readJson(path.join(ROOT, 'ai/approved-models.json'), {});

  const runAt = (stats && stats.startTime) || new Date().toISOString();
  const essentialRows = (trace.requirements || []).filter((r) => r.essential).map((r) =>
    `| ${r.flow} | ${r.id} — ${r.title} | ${r.tests.map((t) => '`' + t.file + '`').join('<br>') || '—'} | ${r.covered ? (r.passing ? 'covered/passing' : 'covered/failing') : 'UNCOVERED'} |`).join('\n');

  const pack = {
    generatedAt: new Date().toISOString(),
    runStartedAt: runAt,
    execution: { passed: stats.expected || 0, failed: stats.unexpected || 0, skipped: stats.skipped || 0, flakinessIndex: flak.flakinessIndex },
    coverage: trace.summary || {},
    contract: { breaking: contract.breakingCount, mode: contract.mode },
    aiGovernance: { defaultModel: aiPolicy.defaultModel, approvedModels: (aiPolicy.approved || []).map((m) => m.id), dataHandlingPolicy: aiPolicy.dataHandlingPolicy },
  };

  const md = `# Compliance-aware QA Evidence Pack

_Generated ${pack.generatedAt} · for the run started ${pack.runStartedAt}_

> Structured, audit-ready QA evidence for internal control reviews and regulated
> environments. Contains **no legal interpretation** — only organised evidence.

## 1. Traceability — essential business flows → automated tests

Essential-flow coverage: **${pack.coverage.essentialCoveragePct || 0}%** (target 100%).
Overall requirement coverage: **${pack.coverage.coveragePct || 0}%** (${pack.coverage.covered || 0}/${pack.coverage.total || 0}).

| Business flow | Requirement | Covering test(s) | Status |
|---|---|---|---|
${essentialRows || '| — | — | — | — |'}

Full matrix: [\`docs/traceability-matrix.md\`](../traceability-matrix.md).

## 2. CI execution evidence

- Tests passed: **${pack.execution.passed}**, failed: **${pack.execution.failed}**, skipped: **${pack.execution.skipped}**
- Flakiness index: **${(pack.execution.flakinessIndex * 100).toFixed(2)}%**
- Machine-readable: \`artifacts/reports/junit.xml\`, \`artifacts/reports/results.json\`
- Failure forensics: traces, screenshots and videos retained on failure; full Allure report published as a CI artifact.

## 3. API contract enforcement

- Breaking changes vs baseline: **${pack.contract.breaking}** (mode: ${pack.contract.mode}) — detector: oasdiff over each in-scope OpenAPI surface.

## 4. Change history & access controls

- All test changes land via Merge/Pull Requests; **direct pushes to protected branches are blocked**.
- Each MR/PR records author, reviewer/approver, CI result, and timestamp (SCM-native audit trail).

## 5. Defect remediation records

Link every production defect on an essential flow to a **regression test added in the fixing MR**:

| Defect ID | Flow | Root cause | Regression test (req id) | MR | Status |
|---|---|---|---|---|---|
| _e.g. INC-0000_ | _flow_ | _…_ | _REQ-…_ | _!000_ | _closed_ |

(Template — populated as incidents are remediated.)

## 6. AI governance

- Default model: **${pack.aiGovernance.defaultModel || 'n/a'}**; approved models: ${(pack.aiGovernance.approvedModels || []).join(', ') || 'n/a'}.
- Model usage is **allowlist-gated in code**; a non-approved model is refused.
- Self-healing changes are fully audited (\`artifacts/healing-audit/healing.jsonl\`).

## 7. IP & ownership

- All work products belong to the adopting organisation; everything is delivered as source in your own
  repository. The shared engine is an open package dependency, not a hosted/black-box service in the gate path.
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'evidence-pack.md'), md);
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'compliance-evidence.json'), JSON.stringify(pack, null, 2));
  console.log(`[compliance] wrote docs/compliance/evidence-pack.md (essential-flow coverage ${pack.coverage.essentialCoveragePct || 0}%)`);
}

module.exports = { build };
if (require.main === module) build();
