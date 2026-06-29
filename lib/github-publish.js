'use strict';
/**
 * GitHub publisher — results land in the SCM workflow, no separate tool. From the
 * platform-neutral summary it produces an upserted PR comment (find-by-marker via
 * GITHUB_TOKEN), a job summary ($GITHUB_STEP_SUMMARY), and writes
 * artifacts/reports/pr-comment.md. Safe no-op outside a PR context.
 */
const fs = require('fs');
const path = require('path');
const { REPORTS } = require('./reports');
const { buildSummary, MARKER } = require('./qa-summary');

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

function prNumber() {
  try {
    const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (ev.pull_request && ev.pull_request.number) return ev.pull_request.number;
    if (ev.number) return ev.number;
  } catch { /* not a PR event */ }
  const m = /refs\/pull\/(\d+)\//.exec(process.env.GITHUB_REF || '');
  return m ? Number(m[1]) : null;
}

function ghHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'qa-kit', 'content-type': 'application/json' };
}

async function upsertComment(comment) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const pr = prNumber();
  if (!repo || !token || !pr) { console.log('[github] PR context not present — wrote markdown artifact only (no API post).'); return; }
  const headers = ghHeaders(token);
  const existing = await (await fetch(`${API}/repos/${repo}/issues/${pr}/comments?per_page=100`, { headers })).json().catch(() => []);
  const mine = Array.isArray(existing) ? existing.find((c) => typeof c.body === 'string' && c.body.includes(MARKER)) : null;
  const url = mine ? `${API}/repos/${repo}/issues/comments/${mine.id}` : `${API}/repos/${repo}/issues/${pr}/comments`;
  const res = await fetch(url, { method: mine ? 'PATCH' : 'POST', headers, body: JSON.stringify({ body: comment }) });
  console.log(`[github] ${mine ? 'PATCH' : 'POST'} PR comment -> ${res.status}`);
}

function writeStepSummary(comment) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) { try { fs.appendFileSync(out, comment + '\n'); } catch { /* ignore */ } }
}

async function run() {
  const { comment, gate } = buildSummary();
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'pr-comment.md'), comment);
  console.log('\n' + comment + '\n');
  writeStepSummary(comment);
  await upsertComment(comment);
  return gate;
}

module.exports = { run };
if (require.main === module) run().then((gate) => { if (process.env.QA_GATE_ENFORCE === '1' && !gate) process.exit(1); });
