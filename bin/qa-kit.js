#!/usr/bin/env node
'use strict';
/**
 * qa-kit — the pipeline-facing CLI for qa-kit. Runs against the CURRENT
 * project (cwd); the generic engine lives in this package, so a consumer repo
 * keeps only its specs, requirements, auth/seam adapters and config.
 *
 *   qa-kit report      traceability matrix + compliance evidence pack
 *   qa-kit dashboard   generate the Allure HTML report (artifacts/allure-report)
 *   qa-kit contract    oasdiff breaking-change diff across contracts.json
 *   qa-kit explore     exploratory crawl of WEB_BASE (advisory suggestions)
 *   qa-kit quarantine  enforce @quarantine owner+expiry annotations
 *   qa-kit gate        quarantine + contract + reports + PR comment (blocking)
 *   qa-kit init        scaffold qa.config.json + a starter spec
 *   qa-kit help
 */
const path = require('path');
const fs = require('fs');

process.env.QA_PROJECT_DIR = process.env.QA_PROJECT_DIR || process.cwd();
const ROOT = process.env.QA_PROJECT_DIR;

function dashboard() {
  const allure = require('allure-commandline');
  const results = process.env.QA_ALLURE_RESULTS || path.join(ROOT, 'allure-results');
  const out = path.join(ROOT, 'artifacts/allure-report');
  if (!fs.existsSync(results)) { console.error(`[dashboard] no allure-results at ${results} — run the suite with the allure reporter first.`); return 1; }
  return new Promise((resolve) => {
    const child = allure(['generate', results, '-o', out, '--clean']);
    child.on('exit', (code) => { console.log(`[dashboard] allure report -> ${path.relative(ROOT, out)} (exit ${code})`); resolve(code || 0); });
  });
}

async function report() {
  require('../lib/traceability').build();
  require('../lib/compliance').build();
  return 0;
}

async function gate() {
  let status = 0;
  status |= require('../lib/quarantine').run();
  status |= require('../lib/contract-diff').run();
  await report();
  try { await require('../lib/publish').run(); } catch (e) { console.warn('[gate] MR/PR comment skipped:', e.message); }
  return status ? 1 : 0;
}

function init() {
  const cfg = path.join(ROOT, 'qa.config.json');
  const specDir = path.join(ROOT, 'tests/e2e');
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, JSON.stringify({
      webBase: 'http://localhost:3000',
      apiBase: 'http://localhost:8000',
      testDir: 'tests/e2e',
      contracts: 'contracts.json',
      exploreRoutes: [{ path: '/', flow: 'home' }],
    }, null, 2) + '\n');
    console.log('[init] wrote qa.config.json');
  } else console.log('[init] qa.config.json exists — left untouched.');
  fs.mkdirSync(specDir, { recursive: true });
  const starter = path.join(specDir, 'starter.spec.ts');
  if (!fs.existsSync(starter)) {
    fs.writeFileSync(starter, `import { test, expect } from '@playwright/test';\n\n// Tag the title with @req:/@flow: so it lands in the traceability matrix.\ntest('@smoke @req:REQ-HOME-001 @flow:home app loads', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/.+/);\n});\n`);
    console.log('[init] wrote tests/e2e/starter.spec.ts');
  }
  console.log(`\nNext:\n  1. playwright.config.ts: import { definePlaywrightConfig } from 'qa-kit/config'\n  2. Implement an AuthAdapter + TestDataSeam (see qa-kit/adapters) for your app.\n  3. CI: reference templates/qa.github.yml (or call \`npx qa-kit gate\`).`);
  return 0;
}

function help() {
  console.log(`qa-kit — pipeline-facing CLI; runs against the current project (cwd).

  qa-kit report      traceability matrix + compliance evidence pack
  qa-kit dashboard   generate the Allure HTML report (artifacts/allure-report)
  qa-kit contract    oasdiff breaking-change diff across contracts.json
  qa-kit explore     exploratory crawl of WEB_BASE (advisory suggestions)
  qa-kit quarantine  enforce @quarantine owner+expiry annotations
  qa-kit publish     post the QA summary to the MR/PR (GitHub or GitLab, auto-detected)
  qa-kit gate        quarantine + contract + reports + MR/PR comment (blocking)
  qa-kit init        scaffold qa.config.json + a starter spec
  qa-kit help`);
  return 0;
}

const cmd = process.argv[2];
const table = {
  report, dashboard, contract: () => require('../lib/contract-diff').run(), explore: () => require('../lib/explore').main(),
  quarantine: () => require('../lib/quarantine').run(), publish: () => require('../lib/publish').run().then(() => 0), gate, init, help, '--help': help, '-h': help,
};
const fn = table[cmd] || (cmd ? null : help);
if (!fn) { console.error(`qa-kit: unknown command '${cmd}'. Try 'qa-kit help'.`); process.exit(2); }
Promise.resolve(fn()).then((code) => process.exit(code || 0));
