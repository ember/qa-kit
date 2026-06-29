'use strict';
/**
 * Platform-neutral QA-gate summary, built from the run artifacts. The GitHub
 * publisher renders the same comment + gate verdict from this.
 */
const path = require('path');
const { REPORTS, readJson, loadHealRecords } = require('./reports');

const MARKER = '<!-- qa-annotation -->';

function pct(n, d) { return d ? +((n / d) * 100).toFixed(1) : 0; }

function buildSummary() {
  const pw = readJson(path.join(REPORTS, 'results.json'), null);
  const stats = (pw && pw.stats) || {};
  const expected = stats.expected || 0, unexpected = stats.unexpected || 0, skipped = stats.skipped || 0;
  const passRate = pct(expected, expected + unexpected);
  const flak = readJson(path.join(REPORTS, 'flakiness.json'), { flakinessIndex: 0, flaky: 0 });
  const trace = readJson(path.join(REPORTS, 'traceability.json'), { summary: {} }).summary || {};
  const contract = readJson(path.join(REPORTS, 'contract-diff.json'), { breakingCount: 0, mode: 'n/a' });
  const heals = loadHealRecords();
  const healed = heals.filter((h) => h.outcome === 'healed').length;
  const healFailed = heals.filter((h) => h.outcome === 'heal_failed').length;

  const gate = unexpected === 0 && (contract.breakingCount === 0 || contract.mode === 'advisory') && healFailed === 0;
  const verdict = gate ? '✅ **QA gate: PASS**' : '❌ **QA gate: FAIL**';

  const comment = [
    MARKER, `## ${verdict}`, '', '| Metric | Value |', '|---|---|',
    `| Pass rate | ${passRate}% (${expected} passed, ${unexpected} failed${skipped ? `, ${skipped} skipped` : ''}) |`,
    `| Flakiness index | ${(flak.flakinessIndex * 100).toFixed(2)}% (${flak.flaky} flaky) |`,
    `| Requirement coverage | ${trace.coveragePct || 0}% (${trace.covered || 0}/${trace.total || 0}) |`,
    `| Essential-flow coverage | ${trace.essentialCoveragePct || 0}% (target 100%) |`,
    `| API contract | ${contract.breakingCount} breaking (${contract.mode}) |`,
    `| Self-healing | ${healed} healed, ${healFailed} unresolved |`, '',
    healFailed ? '> ⚠️ A self-heal could not find a confident match and was surfaced as a real failure — investigate before merging.' : '',
    '📊 Full Allure dashboard, traces, screenshots and videos are attached as CI artifacts.', '',
  ].filter((l) => l !== '').join('\n');

  return { comment, gate, marker: MARKER, metrics: { passRate, expected, unexpected, skipped, healed, healFailed, contract } };
}

module.exports = { buildSummary, MARKER };
