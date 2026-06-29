/**
 * Custom Playwright reporter that derives the flakiness index.
 *
 * A test is "flaky" when it required a retry to pass (failed then passed) within
 * a single run. Persistently flaky tests must be fixed, quarantined with an
 * owner+expiry (@quarantine tag), or removed — never left as silent non-blockers.
 * This reporter writes artifacts/reports/flakiness.json which the dashboard and
 * MR annotation consume, and prints a quarantine-expiry warning.
 */
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { REPORTS_DIR } from '../support/paths';

interface FlakyEntry { title: string; file: string; retries: number; finalStatus: string }

export default class FlakinessReporter implements Reporter {
  private results = new Map<string, { statuses: string[]; file: string; title: string }>();

  onTestEnd(test: TestCase, result: TestResult) {
    const key = test.titlePath().join(' > ');
    const entry = this.results.get(key) || { statuses: [], file: path.relative(process.cwd(), test.location.file), title: key };
    entry.statuses.push(result.status);
    this.results.set(key, entry);
  }

  async onEnd(_result: FullResult) {
    let passed = 0, failed = 0, skipped = 0, flaky = 0;
    const flakyTests: FlakyEntry[] = [];
    for (const { statuses, file, title } of this.results.values()) {
      const final = statuses[statuses.length - 1];
      const ranMoreThanOnce = statuses.length > 1;
      const everFailed = statuses.some((s) => s === 'failed' || s === 'timedOut');
      if (final === 'passed') {
        passed++;
        if (ranMoreThanOnce && everFailed) { flaky++; flakyTests.push({ title, file, retries: statuses.length - 1, finalStatus: final }); }
      } else if (final === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }
    const total = passed + failed + skipped;
    const flakinessIndex = total ? +(flaky / total).toFixed(4) : 0;
    const summary = { generatedAt: new Date().toISOString(), total, passed, failed, skipped, flaky, flakinessIndex, flakyTests };

    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, 'flakiness.json'), JSON.stringify(summary, null, 2));

    if (flaky > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n⚠️  Flakiness index: ${(flakinessIndex * 100).toFixed(2)}% (${flaky} flaky). ` +
        `Fix, quarantine with owner+expiry, or remove — non-blocking flaky tests are not acceptable.`);
    }
  }
}
