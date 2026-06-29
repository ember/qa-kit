'use strict';
/**
 * OpenAPI breaking-change detector for ALL in-scope APIs, powered by oasdiff
 * (https://github.com/oasdiff/oasdiff). Reads the consumer's contracts manifest
 * (a list of { name, spec, baseline }, paths relative to the project root) and per
 * API runs `oasdiff breaking <baseline> <spec>`.
 *
 * oasdiff resolution: a local `oasdiff` on PATH, else the `tufin/oasdiff` Docker
 * image. In CI, install it (oasdiff/oasdiff-action) or rely on Docker.
 *
 * Output: artifacts/reports/contract-diff.json (shape consumed by the QA summary).
 * Exit 1 if breaking in ANY API AND CONTRACT_MODE=blocking (default); advisory exits 0.
 *   --update snapshots every current spec as its baseline.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.QA_PROJECT_DIR || process.cwd();
const CONTRACTS = process.env.QA_CONTRACTS || path.join(ROOT, 'contracts.json');
const OUT = path.join(ROOT, 'artifacts/reports/contract-diff.json');
const MODE = process.env.CONTRACT_MODE === 'advisory' ? 'advisory' : 'blocking';

function resolveRunner() {
  try { execFileSync('oasdiff', ['--version'], { stdio: 'ignore' }); return 'local'; } catch { /* not on PATH */ }
  try { execFileSync('docker', ['info'], { stdio: 'ignore' }); return 'docker'; } catch { return null; }
}

function oasdiffBreaking(runner, relBaseline, relSpec) {
  let out;
  if (runner === 'local') {
    out = execFileSync('oasdiff', ['breaking', path.join(ROOT, relBaseline), path.join(ROOT, relSpec), '-f', 'json'], { encoding: 'utf8' });
  } else {
    out = execFileSync('docker', ['run', '--rm', '-v', `${ROOT}:/specs`, 'tufin/oasdiff',
      'breaking', `/specs/${relBaseline}`, `/specs/${relSpec}`, '-f', 'json'], { encoding: 'utf8' });
  }
  const trimmed = (out || '').trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed); } catch { return []; }
}

function bucket(items) {
  const breaking = [], safe = [];
  for (const it of items) {
    const msg = it.text || it.id || JSON.stringify(it);
    const where = it.operation && it.path ? ` (${String(it.operation).toUpperCase()} ${it.path})` : '';
    ((it.level == null || it.level >= 3) ? breaking : safe).push(`${msg}${where}`);
  }
  return { breaking, safe };
}

function run() {
  if (!fs.existsSync(CONTRACTS)) {
    console.log(`[contract-diff] no contracts manifest at ${path.relative(ROOT, CONTRACTS)} — nothing to diff.`);
    return 0;
  }
  const { contracts } = JSON.parse(fs.readFileSync(CONTRACTS, 'utf8'));
  const update = process.argv.includes('--update');

  if (update) {
    for (const c of contracts) {
      fs.copyFileSync(path.resolve(ROOT, c.spec), path.resolve(ROOT, c.baseline));
      console.log(`[contract-diff] ${c.name}: baseline snapshot updated -> ${c.baseline}`);
    }
    return 0;
  }

  const runner = resolveRunner();
  if (!runner) {
    console.error('[contract-diff] oasdiff not found: install it (brew install oasdiff / oasdiff-action) or run Docker.');
    return MODE === 'blocking' ? 1 : 0;
  }

  const results = [];
  let totalBreaking = 0, totalSafe = 0;
  const allBreaking = [];

  for (const c of contracts) {
    const baselinePath = path.resolve(ROOT, c.baseline);
    if (!fs.existsSync(baselinePath)) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.copyFileSync(path.resolve(ROOT, c.spec), baselinePath);
      console.log(`[contract-diff] ${c.name}: no baseline; initialised from current spec (no diff on first run).`);
      results.push({ name: c.name, breakingCount: 0, safeCount: 0, breaking: [], safe: [] });
      continue;
    }
    const items = oasdiffBreaking(runner, c.baseline, c.spec);
    const { breaking, safe } = bucket(items);
    totalBreaking += breaking.length; totalSafe += safe.length;
    allBreaking.push(...breaking.map((b) => `${c.name}: ${b}`));
    results.push({ name: c.name, breakingCount: breaking.length, safeCount: safe.length, breaking, safe });
    console.log(`[contract-diff] ${c.name}: breaking=${breaking.length} warn=${safe.length}`);
    breaking.forEach((b) => console.log(`  ✖ BREAKING  ${b}`));
    safe.forEach((s) => console.log(`  ~ warn      ${s}`));
  }

  const report = { generatedAt: new Date().toISOString(), engine: `oasdiff (${runner})`, mode: MODE, breakingCount: totalBreaking, safeCount: totalSafe, breaking: allBreaking, contracts: results };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`[contract-diff] engine=oasdiff(${runner}) mode=${MODE}  total breaking=${totalBreaking}  warn=${totalSafe}  (${results.length} API(s))`);

  if (totalBreaking && MODE === 'blocking') { console.error('\n[contract-diff] FAIL: breaking API changes detected (blocking mode).'); return 1; }
  if (totalBreaking) console.warn('\n[contract-diff] advisory mode: breaking changes reported but not blocking.');
  return 0;
}

module.exports = { run };
if (require.main === module) process.exit(run());
