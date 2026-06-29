/**
 * Self-healing audit trail. Every heal — and every refusal to heal — is appended
 * as a JSON line so anyone can review what changed and why. The QA summary and PR
 * comment read this file; a follow-up MR should make the new selector permanent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HEALING_AUDIT_DIR } from './paths';

export type HealOutcome = 'healed' | 'no_heal_needed' | 'heal_failed';

export interface HealRecord {
  ts: string;
  test: string;
  elementId: string;
  critical: boolean;
  outcome: HealOutcome;
  primarySelector: string;
  healedStrategy?: string;
  healedSelector?: string;
  confidence?: number;
  candidatesConsidered: number;
  url: string;
  note?: string;
}

const AUDIT_FILE = path.join(HEALING_AUDIT_DIR, 'healing.jsonl');

export function recordHeal(rec: HealRecord): void {
  try {
    fs.mkdirSync(HEALING_AUDIT_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n');
  } catch {
    /* never let audit IO break a test run */
  }
}

export function readHealRecords(): HealRecord[] {
  try {
    return fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HealRecord);
  } catch {
    return [];
  }
}

export function resetHealAudit(): void {
  try { fs.rmSync(AUDIT_FILE, { force: true }); } catch { /* ignore */ }
}
