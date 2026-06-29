/**
 * Learned selector baseline (the data behind ambient self-healing).
 *
 * On GREEN runs, the healing fixture records a "fingerprint" (role, accessible
 * name, text, tag) of each element a locator resolves to, keyed by the locator
 * call itself (e.g. `testid:login-submit`). On a later run, if that locator
 * misses (the selector drifted), the fixture recovers the element from this
 * stored fingerprint — so EXISTING tests heal without their locators being
 * rewritten. The file is meant to be committed (like visual snapshots).
 */
import * as fs from 'fs';
import * as path from 'path';

export interface Fingerprint { role?: string; name?: string; text?: string; tag?: string }

function baselineFile(): string {
  const dir = process.cwd();
  return process.env.SELECTOR_BASELINE || path.join(dir, 'artifacts', 'selector-baseline.json');
}

let cache: Record<string, Fingerprint> | null = null;

export function loadBaseline(): Record<string, Fingerprint> {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(baselineFile(), 'utf8')); } catch { cache = {}; }
  return cache!;
}

export function getFingerprint(key: string): Fingerprint | undefined {
  return loadBaseline()[key];
}

export function recordFingerprint(key: string, fp: Fingerprint): void {
  const b = loadBaseline();
  // Only learn meaningful fingerprints (need at least a role+name or text).
  if (!fp || (!fp.name && !fp.text)) return;
  b[key] = fp;
}

export function saveBaseline(): void {
  if (!cache) return;
  try {
    const f = baselineFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(cache, null, 2));
  } catch { /* never break a run on baseline IO */ }
}
