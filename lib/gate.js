// The gate. One interface, swappable model behind it:
//   judgeBatch(hooks, skillText, calls) -> [{ verdict: 'pass'|'kill', confidence: 0..1, reason }]
// "borderline" is derived here: any verdict whose confidence is under BORDER goes to the human.
const { ask, extractJson, pool, hasKey } = require('./llm');

function provider() {
  const want = (process.env.GATE || '').toLowerCase();
  if (want === 'jev' || want === 'claude' || want === 'mock') return want;
  return hasKey() ? 'claude' : 'mock';
}

// Confidence is max(p, 1 - p). Jev returns a real probability, so its default band is
// p(approve) between 0.30 and 0.70 (confidence under 0.70). Claude and mock use 0.75.
// 0.70 was set on 13 Nov from one live run of 200: hype that passed scored a median 0.71,
// clean hooks 0.80. It is tuned on that one run, not validated on a second.
function border() {
  const isJev = provider() === 'jev';
  const b = Number((isJev && process.env.JEV_BORDER) || process.env.BORDER);
  if (b > 0 && b < 1) return b;
  return isJev ? 0.7 : 0.75;
}

// ---------- Claude ----------
async function claudeBatch(hooks, skillText, calls) {
  const examples = calls
    .slice(-40)
    .map((c) => `${c.verdict}: "${c.hook}"${c.why ? ` (${c.why})` : ''}`)
    .join('\n');
  const list = hooks.map((h, i) => `${i}. ${h}`).join('\n');
  const prompt = `You are the sign-off gate for ad-copy hooks. You apply ONE person's taste, written in the skill file below. You do not apply your own taste.

<skill_file>
${skillText || '(empty: no rules learned yet)'}
</skill_file>

<their_past_calls>
${examples || '(none yet)'}
</their_past_calls>

For each hook, decide whether this person would APPROVE it (verdict "pass") or REJECT it (verdict "kill").
Give a confidence from 0 to 1 that they would agree with you. Be honest: when the skill file and past calls do not clearly cover a hook, confidence must be low (under 0.7). Low confidence is the correct answer for edge cases; it sends the hook to the human.
Give a reason of at most 14 words that names the rule or past call you relied on.

<hooks>
${list}
</hooks>

Reply with only a JSON array, one object per hook, in order:
[{"i":0,"verdict":"pass","confidence":0.9,"reason":"..."}]`;
  const text = await ask(prompt, { maxTokens: 8000 });
  const arr = extractJson(text);
  return hooks.map((_, i) => {
    const r = arr.find((x) => Number(x.i) === i) || arr[i] || {};
    const verdict = r.verdict === 'pass' ? 'pass' : 'kill';
    let confidence = Number(r.confidence);
    if (!(confidence >= 0 && confidence <= 1)) confidence = 0.5;
    return { verdict, confidence, reason: String(r.reason || 'no reason returned').slice(0, 160) };
  });
}

// ---------- Mock (offline wiring test; labelled MOCK in the UI) ----------
const STOP = new Set('a an the of to in on for with and or but is are was i my me you your this that it its at be by from about what why how'.split(' '));
function tokens(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  return a.filter((w) => setB.has(w)).length / Math.sqrt(a.length * b.length);
}
function mockBatch(hooks, _skillText, calls) {
  const yes = calls.filter((c) => c.verdict === 'APPROVE').map((c) => ({ c, t: tokens(c.hook) }));
  const no = calls.filter((c) => c.verdict === 'REJECT').map((c) => ({ c, t: tokens(c.hook) }));
  return hooks.map((hook) => {
    const t = tokens(hook);
    const best = (group) => group.reduce((m, g) => {
      const s = overlap(t, g.t);
      return s > m.s ? { s, c: g.c } : m;
    }, { s: 0, c: null });
    const a = best(yes);
    const r = best(no);
    const margin = a.s - r.s;
    const verdict = margin >= 0 ? 'pass' : 'kill';
    const confidence = Math.max(0.5, Math.min(0.97, 0.55 + Math.abs(margin) * 1.6));
    const near = margin >= 0 ? a.c : r.c;
    const reason = near
      ? `closest to your ${near.verdict.toLowerCase()} call: "${near.hook.slice(0, 50)}"`
      : 'no similar past call';
    return { verdict, confidence: Number(confidence.toFixed(2)), reason };
  });
}

// ---------- Jev ----------
function jevBatch(hooks, skillText, calls) {
  const adapter = require('../adapters/jev');
  return adapter.judgeBatch(hooks, skillText, calls);
}

async function judgeBatch(hooks, skillText, calls) {
  const p = provider();
  if (p === 'jev') return jevBatch(hooks, skillText, calls);
  if (p === 'claude') return claudeBatch(hooks, skillText, calls);
  return mockBatch(hooks, skillText, calls);
}

// Plain-word backstop for every provider: a hook that names a child goes to a person.
// "Sleep like a baby" is an idiom, not a child. Relationship words (son, daughter) are left to
// the Jev question, because an adult son handing over a bottle is not a child using it.
const CHILD_WORDS = /\b(toddlers?|kids?|kiddos?|child(?:ren)?|bab(?:y|ies)|infants?|newborns?|teen(?:s|age|ager|agers)?|preschoolers?|\d{1,2}[- ]year[- ]old)\b/i;
function mentionsChild(hook) {
  return CHILD_WORDS.test(String(hook || '').replace(/like a baby/gi, ''));
}

// Screen any number of hooks. Returns one result per hook with a derived status.
async function screen(hooks, skillText, calls, onProgress = () => {}) {
  const size = 20;
  const chunks = [];
  for (let i = 0; i < hooks.length; i += size) chunks.push(hooks.slice(i, i + size));
  let done = 0;
  const results = await pool(chunks, 6, async (chunk) => {
    let res;
    try {
      res = await judgeBatch(chunk, skillText, calls);
    } catch (err) {
      console.error('gate: batch failed:', err.message);
      // A failed batch goes to the human. It is never silently passed.
      res = chunk.map(() => ({ verdict: 'kill', confidence: 0, reason: `gate error: ${err.message.slice(0, 80)}` }));
    }
    done += chunk.length;
    onProgress(done, hooks.length);
    return res;
  });
  const b = border();
  return results.flat().map((r, i) => {
    // Only a hook that would otherwise pass is re-routed. A kill stays a kill.
    const byWord = r.verdict === 'pass' && r.route !== 'human' && mentionsChild(hooks[i]);
    const toHuman = r.route === 'human' || byWord;
    return {
      lean: r.verdict,
      confidence: r.confidence,
      reason: byWord ? `needs you: names a child · ${r.reason}`.slice(0, 160) : r.reason,
      status: toHuman || r.confidence < b ? 'borderline' : r.verdict,
    };
  });
}

module.exports = { screen, judgeBatch, provider, border, mentionsChild };
