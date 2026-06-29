# qa-kit

A reusable, AI-native QA engine for Playwright, called by your pipeline through one CLI.
Install it once per project; the **generic engine lives in the package**, so your repo
keeps only the code that is genuinely app-specific.

## What the package provides (generic — not copied into your repo)
- **Self-healing locators** — ambient healing fixture + engine + audit trail
- **Requirement traceability matrix** — from `@req:`/`@flow:` tags → coverage + essential-flow gate
- **Contract gate** — `oasdiff` breaking-change detection across your OpenAPI surfaces
- **Allure dashboard** — rich HTML report (replaces bespoke dashboards)
- **Exploratory agent** — advisory crawl that surfaces gaps/odd states
- **Flakiness reporter + quarantine gate** (owner+expiry)
- **Compliance evidence pack** + **PR/MR comment**
- **`definePlaywrightConfig()`** factory + **AuthAdapter / TestDataSeam** interfaces

## What stays in YOUR repo (irreducible, app-specific)
- your **specs** and the **requirement registry** (`tests/e2e/support/requirements.ts`)
- an **AuthAdapter** + **TestDataSeam** implementation (your login + isolated test data)
- your app's **`data-testid`s** / selectors (or rely on semantic/self-healing mode)
- **config**: `qa.config.json`, the **OpenAPI baseline(s)** + `contracts.json`, `ai/approved-models.json`
- a thin **CI** file referencing `templates/qa.github.yml` (or calling `npx qa-kit …`)

## Install
```bash
npm i -D qa-kit github:ember/qa-kit#v0   # git dependency form
npx qa-kit init                                                 # qa.config.json + starter spec
```
```ts
// playwright.config.ts
import { definePlaywrightConfig } from 'qa-kit/config';
export default definePlaywrightConfig({ testDir: 'tests/e2e', webBase: process.env.WEB_BASE, projects: [/* yours */] });
```
```ts
// tests/e2e/support/fixtures.ts — implement the two seams for your app
import { createTest, AuthAdapter, TestDataSeam } from 'qa-kit/adapters';
const auth: AuthAdapter = { async login(role, { context, baseURL }) { /* your login → cookies */ return []; } };
export const { test, expect } = createTest({ auth /*, data */ });
```

## CLI (pipeline-facing)
```
qa-kit report      traceability matrix + compliance evidence pack
qa-kit dashboard   generate the Allure HTML report (artifacts/allure-report)
qa-kit contract    oasdiff breaking-change diff across contracts.json
qa-kit explore     exploratory crawl of WEB_BASE (advisory)
qa-kit quarantine  enforce @quarantine owner+expiry
qa-kit gate        quarantine + contract + reports + PR comment (blocking)
qa-kit init        scaffold qa.config.json + a starter spec
```

External engines used (OSS, not reinvented): **Playwright**, **Allure**, **oasdiff**.
