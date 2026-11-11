// The human's approve/reject calls. One line each:
//   - APPROVE | hook text | why
//   - REJECT  | hook text | why
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CALLS = path.join(ROOT, 'calls', 'calls.md');
const HOLDOUT = path.join(ROOT, 'calls', 'holdout.md');
const SEEDS = path.join(ROOT, 'seeds', 'hooks.md');

function parseCalls(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const parts = line.slice(2).split('|').map((s) => s.trim());
    if (parts.length < 2) continue;
    const verdict = parts[0].toUpperCase();
    if (verdict !== 'APPROVE' && verdict !== 'REJECT') continue;
    out.push({
      verdict,
      hook: parts[1].replace(/\[PLACEHOLDER\]/g, '').trim(),
      why: (parts[2] || '').replace(/\[PLACEHOLDER\]/g, '').trim(),
      placeholder: line.includes('[PLACEHOLDER]'),
    });
  }
  return out;
}

function readFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readCalls() {
  return parseCalls(readFile(CALLS));
}

function readHoldout() {
  return parseCalls(readFile(HOLDOUT));
}

function appendCall({ verdict, hook, why }) {
  const clean = (s) => String(s || '').replace(/[|\n\r]/g, ' ').trim();
  const line = `- ${verdict} | ${clean(hook)} | ${clean(why) || 'called live in the inbox'}\n`;
  const current = readFile(CALLS);
  fs.appendFileSync(CALLS, (current.endsWith('\n') || !current ? '' : '\n') + line);
}

// Seed patterns: every line starting with "- ".
function readSeeds() {
  return readFile(SEEDS)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => ({
      pattern: l.slice(2).replace(/\[PLACEHOLDER\]/g, '').trim(),
      placeholder: l.includes('[PLACEHOLDER]'),
    }));
}

module.exports = { readCalls, readHoldout, appendCall, readSeeds, parseCalls, ROOT };
