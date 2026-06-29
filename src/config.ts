/**
 * Playwright config factory. A consumer's playwright.config.ts becomes ~3 lines:
 *
 *   import { definePlaywrightConfig } from 'qa-kit/config';
 *   export default definePlaywrightConfig({
 *     testDir: 'tests/e2e', webBase: process.env.WEB_BASE, projects: [...] ,
 *   });
 *
 * It wires the reporter stack the QA engine expects (list + json + junit + Allure
 * dashboard + flakiness reporter) so the report/dashboard/summary tools have their
 * inputs, and applies sensible CI defaults — all overridable via opts.
 */
import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig, Project, ReporterDescription } from '@playwright/test';

export interface QaConfigOptions {
  testDir?: string;
  webBase?: string;
  apiBase?: string;
  projects?: Project[];
  webServer?: PlaywrightTestConfig['webServer'];
  workers?: PlaywrightTestConfig['workers'];
  retries?: number;
  use?: PlaywrightTestConfig['use'];
  /** Extra reporters appended to the qa-kit stack. */
  reporters?: ReporterDescription[];
  /** Override the whole config after the qa-kit defaults are applied. */
  overrides?: Partial<PlaywrightTestConfig>;
}

function reporterModule(spec: string): string {
  try { return require.resolve(spec); } catch { return spec; }
}

export function definePlaywrightConfig(opts: QaConfigOptions = {}): PlaywrightTestConfig {
  const webBase = opts.webBase || process.env.WEB_BASE || 'http://localhost:3000';
  const reporter: ReporterDescription[] = [
    ['list'],
    ['json', { outputFile: 'artifacts/reports/results.json' }],
    ['junit', { outputFile: 'artifacts/reports/junit.xml' }],
    [reporterModule('allure-playwright'), { resultsDir: 'allure-results', detail: true }],
    [reporterModule('qa-kit/reporters')],
    ...(opts.reporters || []),
  ];

  const projects: Project[] = opts.projects && opts.projects.length
    ? opts.projects
    : [{ name: 'e2e', use: { ...devices['Desktop Chrome'], baseURL: webBase } }];

  return defineConfig({
    testDir: opts.testDir || 'tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: opts.retries ?? (process.env.CI ? 2 : 0),
    workers: opts.workers ?? (process.env.CI ? 1 : undefined),
    reporter,
    outputDir: 'artifacts/test-results',
    timeout: 30_000,
    expect: { timeout: 7_000 },
    use: {
      baseURL: webBase,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      actionTimeout: 10_000,
      ...(opts.use || {}),
    },
    projects,
    webServer: opts.webServer,
    ...(opts.overrides || {}),
  });
}

export default definePlaywrightConfig;
