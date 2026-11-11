// Skill file compiler: the human's calls in, a short rule file out (skills/signoff.md).
const fs = require('fs');
const path = require('path');
const { ask, hasKey } = require('./llm');
const { ROOT } = require('./calls');

const SKILL = path.join(ROOT, 'skills', 'signoff.md');

function readSkill() {
  return fs.existsSync(SKILL) ? fs.readFileSync(SKILL, 'utf8') : '';
}

async function claudeCompile(calls, previous) {
  const list = calls.map((c) => `${c.verdict}: "${c.hook}"${c.why ? ` | why: ${c.why}` : ''}`).join('\n');
  const prompt = `You are writing a skill file that captures ONE person's sign-off taste for ad-copy hooks, so an agent can apply it without them.

Their approve/reject calls, oldest first (the last ones are the newest):
${list}

The current skill file:
${previous || '(none yet)'}

Rewrite the skill file. Rules:
- Markdown, exactly these three sections: "## Approve when", "## Kill when", "## Ask the human when".
- At most 5 bullet rules per section, one line each, concrete enough to apply to a new hook.
- Every rule must be supported by at least one call above. Do not invent taste they have not shown.
- Keep existing rules word for word unless the newest calls contradict or sharpen them. Change as little as the evidence requires.
- "Ask the human when" lists the kinds of hook where their calls conflict or are too few to tell.

Reply with only the markdown.`;
  const text = await ask(prompt, { maxTokens: 1200 });
  return text.trim() + '\n';
}

function mockCompile(calls) {
  const line = (c) => `- like "${c.hook.slice(0, 70)}"${c.why ? ` (${c.why.slice(0, 60)})` : ''}`;
  const yes = calls.filter((c) => c.verdict === 'APPROVE').slice(-5).map(line);
  const no = calls.filter((c) => c.verdict === 'REJECT').slice(-5).map(line);
  return [
    '## Approve when', ...(yes.length ? yes : ['- (no approve calls yet)']), '',
    '## Kill when', ...(no.length ? no : ['- (no reject calls yet)']), '',
    '## Ask the human when', '- the hook is not close to any past call', '',
  ].join('\n');
}

function diffLines(before, after) {
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const a = norm(before);
  const b = norm(after);
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    added: b.filter((l) => !setA.has(l) && !l.startsWith('##')),
    removed: a.filter((l) => !setB.has(l) && !l.startsWith('##')),
  };
}

async function compile(calls) {
  const before = readSkill();
  let after;
  let mode = hasKey() ? 'claude' : 'mock';
  if (mode === 'claude') {
    try {
      after = await claudeCompile(calls, before);
    } catch (err) {
      console.error('skill: compile failed, keeping previous file:', err.message);
      return { text: before, diff: { added: [], removed: [] }, provider: mode, error: err.message };
    }
  } else {
    after = mockCompile(calls);
  }
  fs.mkdirSync(path.dirname(SKILL), { recursive: true });
  fs.writeFileSync(SKILL, after);
  return { text: after, diff: diffLines(before, after), provider: mode };
}

module.exports = { compile, readSkill, diffLines };
