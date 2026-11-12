// Comment reader: the "after posting" half of the loop.
// Organic posts carry no ad tracking, but they do carry comments. This reads every comment and
// sorts it: who wants to buy, what stops the others, and who they say they are.
//
//   readComments(text) -> { items: [{ text, kind, kindP, blocker, who }], summary, provider }
//
// Providers follow the gate: jev (one call per comment, three choice questions), claude (batches),
// mock (keyword rules, labelled MOCK in the UI). Comments are pasted in by a person. No scraping.
const { ask, extractJson, pool } = require('./llm');
const gate = require('./gate');

const MAX_COMMENTS = 300;
const UNSURE_UNDER = 0.5; // top "kind" probability under this goes to the human

const KINDS = {
  buy: 'Says they want it, bought it, will buy it, or asks the price or where to get it in order to buy',
  objection: 'Doubts it, complains, or gives a reason not to buy',
  question: 'Asks about the product or post without signalling a purchase',
  praise: 'Likes the post or the product with no purchase signal',
  noise: 'Off-topic, spam, a tag of a friend, or emoji only',
};
const BLOCKERS = {
  price: 'Says it costs too much or asks for a discount',
  trust: 'Doubts that it works, is safe, is real, or that the post is honest',
  fit: 'Says it is not for them: taste, need, timing, or they already use something else',
  none: 'States no reason against buying',
};
const WHO = {
  parent: 'Says they are a parent or are buying for their child',
  young: 'Says they are a student, a teenager or in their early twenties',
  working: 'Mentions their job, shift, office or business',
  older: 'Says they are older, retired, or mentions age-related needs',
  unstated: 'Says nothing about who they are',
};

function split(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 1)
    .slice(0, MAX_COMMENTS)
    .map((l) => l.slice(0, 400));
}

// ---------- Jev ----------
function jevRequest(comment, model) {
  const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
  return {
    model,
    state: comment,
    questions: {
      kind: choice('This is one comment on a social post that promotes a product. What kind of comment is it?', KINDS),
      blocker: choice('What reason, if any, does this comment give against buying the product?', BLOCKERS),
      who: choice('What does the commenter say about who they are?', WHO),
    },
  };
}

function pick(answer, allowed, fallback) {
  const c = answer && typeof answer === 'object' ? answer.choice : null;
  if (typeof c !== 'string' || !(c in allowed)) return { value: fallback, p: 0 };
  const probs = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {};
  const p = typeof probs[c] === 'number' ? probs[c] : typeof answer.confidence === 'number' ? answer.confidence : 0;
  return { value: c, p: Number(p.toFixed(2)) };
}

function jevMap(json) {
  const a = json && typeof json === 'object' ? json.answers : null;
  if (!a || typeof a !== 'object') throw new Error('Jev response had no answers');
  const kind = pick(a.kind, KINDS, null);
  if (!kind.value) throw new Error('Jev answer missing for kind');
  return { kind: kind.value, kindP: kind.p, blocker: pick(a.blocker, BLOCKERS, 'none').value, who: pick(a.who, WHO, 'unstated').value };
}

async function jevRead(comments) {
  const jev = require('../adapters/jev');
  const model = process.env.JEV_MODEL || 'jev-latest';
  const limit = Math.max(1, Number(process.env.JEV_COMMENT_CONCURRENCY) || 8);
  return pool(comments, limit, async (c) => {
    try {
      return jevMap(await jev.callJev(jevRequest(c, model)));
    } catch (err) {
      return { kind: 'error', kindP: 0, blocker: 'none', who: 'unstated', error: String(err.message).slice(0, 90) };
    }
  });
}

// ---------- Claude ----------
async function claudeRead(comments) {
  const chunks = [];
  for (let i = 0; i < comments.length; i += 40) chunks.push(comments.slice(i, i + 40));
  const out = await pool(chunks, 4, async (chunk) => {
    const prompt = `Each line is one comment on a social post that promotes a product. Classify every comment. Comments may be in English, Tagalog or Taglish.

kind: ${Object.entries(KINDS).map(([k, v]) => `${k} = ${v}`).join('; ')}
blocker: ${Object.entries(BLOCKERS).map(([k, v]) => `${k} = ${v}`).join('; ')}
who: ${Object.entries(WHO).map(([k, v]) => `${k} = ${v}`).join('; ')}

Give p from 0 to 1: how sure you are of kind. Use low p when the comment is ambiguous.

${chunk.map((c, i) => `${i}. ${c}`).join('\n')}

Reply with only a JSON array, one object per comment, in order:
[{"i":0,"kind":"buy","p":0.9,"blocker":"none","who":"unstated"}]`;
    try {
      const arr = extractJson(await ask(prompt, { maxTokens: 3000 }));
      return chunk.map((_, i) => {
        const r = arr.find((x) => Number(x.i) === i) || arr[i] || {};
        const p = Number(r.p);
        return {
          kind: r.kind in KINDS ? r.kind : 'noise',
          kindP: p >= 0 && p <= 1 ? Number(p.toFixed(2)) : 0,
          blocker: r.blocker in BLOCKERS ? r.blocker : 'none',
          who: r.who in WHO ? r.who : 'unstated',
        };
      });
    } catch (err) {
      return chunk.map(() => ({ kind: 'error', kindP: 0, blocker: 'none', who: 'unstated', error: String(err.message).slice(0, 90) }));
    }
  });
  return out.flat();
}

// ---------- Mock (keyword rules; wiring test only, labelled MOCK) ----------
function mockRead(comments) {
  return comments.map((c) => {
    const t = c.toLowerCase();
    const has = (re) => re.test(t);
    let kind = 'praise';
    let kindP = 0.6;
    if (has(/how much|price|magkano|hm\b|where (can i|to) buy|saan (makakabili|nabibili)|order|link|need this|want this|buying|bought|pabili/)) { kind = 'buy'; kindP = 0.9; }
    else if (has(/scam|fake|expensive|mahal|doesn.?t work|not worth|waste|didn.?t work|hindi effective|side effect/)) { kind = 'objection'; kindP = 0.85; }
    else if (has(/\?/)) { kind = 'question'; kindP = 0.7; }
    else if (t.replace(/[^a-z]/g, '').length < 3 || has(/^@/)) { kind = 'noise'; kindP = 0.8; }
    else if (has(/maybe|not sure|hmm|idk/)) { kindP = 0.4; }
    const blocker = has(/expensive|mahal|pricey|discount/) ? 'price' : has(/scam|fake|doesn.?t work|didn.?t work|legit|side effect|safe/) ? 'trust' : has(/not for me|already use|don.?t need/) ? 'fit' : 'none';
    const who = has(/my (kid|son|daughter|baby|anak)|as a (mom|dad|parent)/) ? 'parent' : has(/student|college|school/) ? 'young' : has(/work|office|shift|boss|business/) ? 'working' : has(/retire|senior|at my age|lola|lolo/) ? 'older' : 'unstated';
    return { kind, kindP, blocker, who };
  });
}

function tally(items, key, skip) {
  const out = {};
  for (const it of items) {
    const v = it[key];
    if (v === skip) continue;
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

async function readComments(text) {
  const comments = split(text);
  if (!comments.length) throw new Error('paste at least one comment, one per line');
  const provider = gate.provider();
  const t0 = Date.now();
  const tokensBefore = provider === 'jev' ? require('../adapters/jev').tokensUsed() : 0;
  const read = provider === 'jev' ? await jevRead(comments) : provider === 'claude' ? await claudeRead(comments) : mockRead(comments);
  const items = comments.map((c, i) => ({ text: c, ...read[i] }));

  const ok = items.filter((it) => it.kind !== 'error');
  const sure = ok.filter((it) => it.kindP >= UNSURE_UNDER);
  const unsure = ok.filter((it) => it.kindP < UNSURE_UNDER);
  const buyers = sure.filter((it) => it.kind === 'buy').sort((a, b) => b.kindP - a.kindP);
  const objections = sure.filter((it) => it.kind === 'objection');
  return {
    provider,
    items,
    summary: {
      read: items.length,
      failed: items.length - ok.length,
      needYou: unsure.length,
      kinds: tally(sure, 'kind'),
      buyers: buyers.length,
      buyShare: sure.length ? Number((buyers.length / sure.length).toFixed(3)) : 0,
      blockers: tally(objections, 'blocker', 'none'),
      who: tally(sure, 'who', 'unstated'),
      whoAmongBuyers: tally(buyers, 'who', 'unstated'),
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      jevInputTokens: provider === 'jev' ? require('../adapters/jev').tokensUsed() - tokensBefore : null,
    },
    topBuyers: buyers.slice(0, 8).map((b) => ({ text: b.text, p: b.kindP, who: b.who })),
    topObjections: objections.slice(0, 8).map((o) => ({ text: o.text, p: o.kindP, blocker: o.blocker })),
    unsure: unsure.slice(0, 12).map((u) => ({ text: u.text, p: u.kindP, lean: u.kind })),
  };
}

module.exports = { readComments, split, jevRequest, jevMap, mockRead, KINDS, BLOCKERS, WHO, MAX_COMMENTS };
