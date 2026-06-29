# qa-kit

qa-kit is the QA plumbing you'd otherwise rewrite in every Playwright project —
traceability, contract checks, flakiness tracking, a self-healing locator layer,
and the CI glue that ties them together. It ships as a package and a single CLI,
so your repo holds only the parts that are actually specific to your app.

The split is deliberate: the engine is generic and lives in the dependency; the
things only you can know — how to log in, how to get clean test data, what your
requirements are — stay in your repo.

## What you get from the package

- **Self-healing locators.** A drop-in Playwright fixture that learns each
  element's accessibility fingerprint on green runs and recovers it when a
  selector drifts. It heals *where* an element is, never *whether* something
  worked — assertions still use real locators, so genuine regressions still
  fail. Every heal (and every refusal to heal) is written to an audit trail.
- **Requirement traceability.** Reads `@req:`/`@flow:` tags from your spec
  titles, joins them against a requirement registry and the latest run, and
  emits a coverage matrix with a hard gate on essential flows.
- **Contract checking.** Runs `oasdiff` against your OpenAPI baselines and
  flags breaking changes — blocking by default, advisory if you'd rather.
- **Flakiness + quarantine.** A reporter that computes a flakiness index, plus
  a gate that refuses to let a `@quarantine`d test sit forever: each one needs
  an owner and an expiry date, checked in CI.
- **Reporting.** An Allure HTML dashboard, a compliance evidence pack, and a
  PR comment that summarizes the whole gate in one place.
- **Config + seams.** A `definePlaywrightConfig()` factory that wires the
  reporter stack for you, and two small interfaces (`AuthAdapter`,
  `TestDataSeam`) you implement once per app.

## What stays in your repo

- your specs and a requirement registry (`tests/e2e/support/requirements.ts`)
- an `AuthAdapter` and (optionally) a `TestDataSeam` — your login and your
  isolated test data
- your OpenAPI baselines and a `contracts.json` listing them
- `ai/approved-models.json` if you use the optional LLM enrichment
- a thin CI file that calls the CLI (or reuses `templates/qa.github.yml`)

## Getting started

```bash
npm i -D qa-kit
npx qa-kit init        # writes qa.config.json and a starter spec
```

Point your Playwright config at the factory:

```ts
// playwright.config.ts
import { definePlaywrightConfig } from 'qa-kit/config';

export default definePlaywrightConfig({
  testDir: 'tests/e2e',
  webBase: process.env.WEB_BASE,
  projects: [/* your projects */],
});
```

Implement the two seams for your app:

```ts
// tests/e2e/support/fixtures.ts
import { createTest, AuthAdapter } from 'qa-kit/adapters';

const auth: AuthAdapter = {
  async login(role, { context, baseURL }) {
    // your login → return the cookies that authenticate `role`
    return [];
  },
};

export const { test, expect } = createTest({ auth /*, data */ });
```

To get self-healing for free, import `test`/`expect` from the healing fixture
instead of `@playwright/test`:

```ts
import { test, expect } from 'qa-kit/healing-fixture';
```

## CLI

The pipeline calls these; each one runs against the current project.

```
qa-kit report      traceability matrix + compliance evidence pack
qa-kit dashboard   generate the Allure HTML report
qa-kit contract    oasdiff breaking-change diff across contracts.json
qa-kit explore     exploratory crawl of WEB_BASE (advisory only)
qa-kit quarantine  enforce @quarantine owner+expiry annotations
qa-kit gate        quarantine + contract + reports + PR comment (blocking)
qa-kit init        scaffold qa.config.json and a starter spec
```

## Built on

Playwright, Allure, and oasdiff do the heavy lifting — qa-kit wires them
together rather than reinventing any of them.
