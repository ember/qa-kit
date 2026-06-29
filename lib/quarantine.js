'use strict';
/**
 * Quarantine gate. A test may be temporarily quarantined (tag `@quarantine`) so it
 * does not block the pipeline while being fixed — but ONLY with an owner and an
 * expiry, so quarantine can never become a permanent silent non-blocker. Every
 * quarantined test must carry an adjacent annotation:
 *
 *   // QUARANTINE owner:@handle expires:YYYY-MM-DD reason:short text
 *   test('@quarantine ... ', async () => { ... })
 *
 * Run in a blocking CI stage; fails if any quarantined test lacks the annotation
 * or has passed its expiry.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, listSpecFiles } = require('./reports');

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

function run() {
  const problems = [];
  const quarantined = [];

  for (const file of listSpecFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/\btest(?:\.\w+)?\(\s*['"]([^'"]*@quarantine[^'"]*)['"]/);
      if (!m) return;
      const title = m[1];
      const context = lines.slice(Math.max(0, i - 4), i).join('\n');
      const ann = context.match(/QUARANTINE\s+owner:(\S+)\s+expires:(\d{4}-\d{2}-\d{2})\s+reason:(.+)/);
      const rel = path.relative(ROOT, file);
      if (!ann) {
        problems.push(`${rel}:${i + 1} quarantined test missing "// QUARANTINE owner:@.. expires:YYYY-MM-DD reason:.." annotation\n    ${title}`);
        return;
      }
      const [, owner, expires] = ann;
      quarantined.push({ file: rel, title, owner, expires });
      if (expires < today) problems.push(`${rel}:${i + 1} quarantine EXPIRED (${expires} < ${today}); owner ${owner} must fix or remove\n    ${title}`);
    });
  }

  console.log(`[quarantine] ${quarantined.length} quarantined test(s); checked against ${today}.`);
  for (const q of quarantined) console.log(`  · ${q.owner} until ${q.expires}  ${q.title.replace(/@[^ ]+ /g, '').trim()}  (${q.file})`);

  if (problems.length) {
    console.error('\n[quarantine] FAIL:');
    problems.forEach((p) => console.error('  ✖ ' + p));
    return 1;
  }
  console.log('[quarantine] OK — no missing annotations, no expired quarantines.');
  return 0;
}

module.exports = { run };
if (require.main === module) process.exit(run());
