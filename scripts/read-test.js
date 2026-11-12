// Live check of the comment reader from the command line, no browser needed.
// Usage: node scripts/read-test.js [file]     (default: samples/comments.txt)
// Prints every comment with its label so a person can judge whether the reader is right.
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { readComments } = require('../lib/comments');

(async () => {
  const file = process.argv[2] || path.join(__dirname, '..', 'samples', 'comments.txt');
  const out = await readComments(fs.readFileSync(file, 'utf8'));
  console.log(`read by: ${out.provider}   comments: ${out.summary.read}   failed: ${out.summary.failed}   seconds: ${out.summary.seconds}`);
  for (const it of out.items) {
    const tag = it.kind === 'error' ? `ERROR ${it.error}` : `${it.kind} ${it.kindP}${it.kindP < 0.5 ? ' (unsure)' : ''} | blocker: ${it.blocker} | who: ${it.who}`;
    console.log(`  ${tag.padEnd(58)} <- ${it.text}`);
  }
  const s = out.summary;
  console.log(`want to buy: ${s.buyers}   need a human: ${s.needYou}   kinds: ${JSON.stringify(s.kinds)}`);
  console.log(`blockers: ${JSON.stringify(s.blockers)}   who: ${JSON.stringify(s.who)}`);
  if (s.jevInputTokens !== null) console.log(`Jev input tokens used: ${s.jevInputTokens}`);
  if (s.failed) process.exit(2);
})().catch((err) => {
  console.error('read test failed:', err.message);
  process.exit(1);
});
