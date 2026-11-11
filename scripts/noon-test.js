// Noon checkpoint: does the gate agree with Nap on hooks it has never seen?
// Reads calls/holdout.md, runs the gate with the current skill file, prints the match rate.
// Usage: node scripts/noon-test.js
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { readCalls, readHoldout } = require('../lib/calls');
const gate = require('../lib/gate');
const skill = require('../lib/skill');

(async () => {
  const holdout = readHoldout().filter((c) => !c.placeholder);
  if (!holdout.length) {
    console.log('calls/holdout.md has no real hooks yet (placeholders are skipped). Nothing to test.');
    process.exit(1);
  }
  const calls = readCalls();
  const compiled = await skill.compile(calls);
  const results = await gate.screen(holdout.map((h) => h.hook), compiled.text, calls);

  let match = 0;
  let borderline = 0;
  const misses = [];
  holdout.forEach((h, i) => {
    const r = results[i];
    const agentSays = r.lean === 'pass' ? 'APPROVE' : 'REJECT';
    if (r.status === 'borderline') borderline += 1;
    if (agentSays === h.verdict) match += 1;
    else misses.push(`  you: ${h.verdict}  agent: ${agentSays} (${r.confidence})  "${h.hook}"  <- ${r.reason}`);
  });
  const pct = Math.round((match / holdout.length) * 100);
  console.log(`gate: ${gate.provider()}   hooks tested: ${holdout.length}`);
  console.log(`match rate: ${match}/${holdout.length} = ${pct}%   (bar: 80%)`);
  console.log(`would go to the human as borderline: ${borderline}`);
  if (misses.length) console.log('misses:\n' + misses.join('\n'));
  console.log(pct >= 80 ? 'PASS: keep this gate.' : 'BELOW BAR: propose swapping the model behind the gate. Nap decides.');
})().catch((err) => {
  console.error('noon test failed:', err.message);
  process.exit(1);
});
