/** Artifact locations, resolved against the consumer project (cwd / QA_PROJECT_DIR). */
import * as path from 'path';

const ROOT = process.env.QA_PROJECT_DIR || process.cwd();
export const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
export const REPORTS_DIR = process.env.QA_REPORTS_DIR || path.join(ARTIFACTS_DIR, 'reports');
export const HEALING_AUDIT_DIR = path.dirname(process.env.QA_HEALING_AUDIT || path.join(ARTIFACTS_DIR, 'healing-audit/healing.jsonl'));
