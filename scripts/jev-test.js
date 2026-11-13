// Offline check of the Jev adapter: request shape, answer mapping, failure handling.
// Uses a fake fetch with canned answers. It does NOT prove the live API behaves this way.
// Usage: node scripts/jev-test.js
const assert = require('assert');

process.env.TYPESAFE_API_KEY = 'test-key-not-real';
process.env.GATE = 'jev';
delete process.env.BORDER;
delete process.env.JEV_BORDER;

const jev = require('../adapters/jev');
const gate = require('../lib/gate');

const skill = `## Approve when
- names a specific person or moment
- admits a downside honestly

## Kill when
- uses hype words with no content
- promises a guaranteed result

## Ask the human when
- humour that could read as mean
`;
const calls = [
  { verdict: 'APPROVE', hook: 'My mother laughed at the price until she tried it', why: '' },
  { verdict: 'REJECT', hook: 'This revolutionary product will change your life', why: '' },
];

(async () => {
  // 1. Rules come out of the right sections only.
  const rules = jev.parseRules(skill);
  assert.deepStrictEqual(rules.approve.length, 2);
  assert.deepStrictEqual(rules.kill.length, 2);

  // 2. Request shape.
  const body = jev.buildRequest('Day one I hated it', rules, calls, 'jev-latest');
  assert.strictEqual(body.model, 'jev-latest');
  assert.strictEqual(body.state.hook, 'Day one I hated it');
  assert.deepStrictEqual(body.state.approved_examples, ['My mother laughed at the price until she tried it']);
  assert.deepStrictEqual(body.state.rejected_examples, ['This revolutionary product will change your life']);
  assert.deepStrictEqual(Object.keys(body.questions), ['approve', 'reject', 'generic', 'claim', 'child', 'a_1', 'a_2', 'k_1', 'k_2']);
  assert.ok(Object.values(body.questions).every((q) => q.type === 'noul'));

  // 3. Mapping: clear pass, clear kill, borderline with doubts named.
  const pass = jev.mapResponse({ answers: { approve: { noul: 0.92 }, a_1: { noul: 0.9 }, a_2: { noul: 0.8 }, k_1: { noul: 0.1 }, k_2: { noul: 0.05 } } }, rules);
  assert.deepStrictEqual([pass.verdict, pass.confidence], ['pass', 0.92]);
  assert.ok(pass.reason.includes('no rule in doubt'));
  const kill = jev.mapResponse({ answers: { approve: { noul: 0.08 }, a_1: { noul: 0.1 }, a_2: { noul: 0.2 }, k_1: { noul: 0.95 }, k_2: { noul: 0.3 } } }, rules);
  assert.deepStrictEqual([kill.verdict, kill.confidence], ['kill', 0.92]);
  const edge = jev.mapResponse({ answers: { approve: { noul: 0.58 }, a_1: { noul: 0.31 }, a_2: { noul: 0.7 }, k_1: { noul: 0.72 }, k_2: { noul: 0.1 } } }, rules);
  assert.deepStrictEqual([edge.verdict, edge.confidence], ['pass', 0.58]);
  assert.ok(edge.reason.includes('hits kill rule') && edge.reason.includes('misses'));
  assert.throws(() => jev.mapResponse({ answers: {} }, rules), /missing/);
  // Auto-kills override a high approve score. Rules never decide the verdict.
  const claimKill = jev.mapResponse({ answers: { approve: { noul: 0.9 }, claim: { noul: 0.93 }, generic: { noul: 0.1 } } }, rules);
  assert.deepStrictEqual([claimKill.verdict, claimKill.confidence], ['kill', 0.93]);
  assert.ok(claimKill.reason.startsWith('auto-kill: health'));
  // A passing hook that shows a child using the product is routed to the human, not passed.
  const kid = jev.mapResponse({ answers: { approve: { noul: 0.9 }, claim: { noul: 0.1 }, generic: { noul: 0.1 }, child: { noul: 0.88 } } }, rules);
  assert.deepStrictEqual([kid.verdict, kid.route], ['pass', 'human']);
  assert.ok(kid.reason.startsWith('needs you: a child'));
  const noKid = jev.mapResponse({ answers: { approve: { noul: 0.9 }, child: { noul: 0.2 } } }, rules);
  assert.strictEqual(noKid.route, undefined);
  // A hook the gate would kill anyway stays killed; the child check does not rescue it.
  const kidKill = jev.mapResponse({ answers: { approve: { noul: 0.1 }, child: { noul: 0.9 } } }, rules);
  assert.deepStrictEqual([kidKill.verdict, kidKill.route], ['kill', undefined]);
  // Word backstop, any provider.
  assert.ok(gate.mentionsChild("Hear me out: my toddler's bedtime is a breeze now."));
  assert.ok(gate.mentionsChild("My neighbor's kid now goes down without a fight."));
  assert.ok(!gate.mentionsChild('At 36 I thought sleep was just hard, now I sleep like a baby forever.'));
  assert.ok(!gate.mentionsChild('I counted sheep for six years. Then my son left this on my desk.'));
  assert.strictEqual(gate.border(), 0.7);
  const slopKill = jev.mapResponse({ answers: { approve: { noul: 0.9 }, claim: { noul: 0.1 }, generic: { noul: 0.85 } } }, rules);
  assert.ok(slopKill.verdict === 'kill' && slopKill.reason.includes('generic AI copy'));
  // Both directions are averaged: a "yes" to both questions lands in the middle.
  const yesToBoth = jev.mapResponse({ answers: { approve: { noul: 0.84 }, reject: { noul: 0.8 } } }, rules);
  assert.deepStrictEqual([yesToBoth.verdict, yesToBoth.confidence], ['pass', 0.52]);
  const agree = jev.mapResponse({ answers: { approve: { noul: 0.9 }, reject: { noul: 0.1 } } }, rules);
  assert.deepStrictEqual([agree.verdict, agree.confidence], ['pass', 0.9]);
  const rulesIgnored = jev.mapResponse({ answers: { approve: { noul: 0.9 }, a_1: { noul: 0.0 }, a_2: { noul: 0.0 }, k_1: { noul: 1.0 }, k_2: { noul: 1.0 } } }, rules);
  assert.strictEqual(rulesIgnored.verdict, 'pass', 'rule answers explain, they do not decide');

  // 4. Through the gate with a fake fetch: statuses, auth header, one failure routed to the human.
  const canned = { 'clear pass': 0.93, 'clear kill': 0.06, 'on the edge': 0.55 };
  let sawAuth = false;
  global.fetch = async (_url, opts) => {
    sawAuth = opts.headers.Authorization === 'Bearer test-key-not-real';
    const hook = JSON.parse(opts.body).state.hook;
    if (hook === 'server says no') return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers: { approve: { noul: canned[hook] } }, usage: { input_tokens: 50 } }) };
  };
  assert.strictEqual(gate.border(), 0.7, 'Jev uses the 0.30 to 0.70 band by default');
  const res = await gate.screen(['clear pass', 'clear kill', 'on the edge', 'server says no'], skill, calls);
  assert.deepStrictEqual(res.map((r) => r.status), ['pass', 'kill', 'borderline', 'borderline']);
  assert.strictEqual(res[2].lean, 'pass');
  assert.ok(res[3].reason.startsWith('gate error'), 'a failed hook goes to the human with the error shown');
  assert.ok(sawAuth, 'bearer key sent');
  assert.strictEqual(jev.tokensUsed(), 150, 'input tokens are counted');

  // 5. Comment reader: request shape and choice mapping, with a fake fetch.
  const comments = require('../lib/comments');
  const creq = comments.jevRequest('magkano po?', 'jev-latest');
  assert.deepStrictEqual(Object.keys(creq.questions), ['kind', 'blocker', 'who']);
  assert.ok(Object.values(creq.questions).every((q) => q.type === 'choice' && Object.keys(q.criteria).length >= 4));
  const mapped = comments.jevMap({ answers: {
    kind: { type: 'choice', choice: 'buy', confidence: 0.7, probabilities: { buy: 0.86, question: 0.14 } },
    blocker: { type: 'choice', choice: 'none', probabilities: { none: 0.9 } },
    who: { type: 'choice', choice: 'parent', probabilities: { parent: 0.6 } },
  } });
  assert.deepStrictEqual(mapped, { kind: 'buy', kindP: 0.86, blocker: 'none', who: 'parent' });
  assert.throws(() => comments.jevMap({ answers: { kind: { choice: 'not-a-kind' } } }), /missing/);
  global.fetch = async (_url, opts) => {
    const c = JSON.parse(opts.body).state;
    if (c === 'boom') return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad' };
    const kind = c.includes('price') ? 'buy' : 'praise';
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers: { kind: { choice: kind, probabilities: { [kind]: 0.9 } }, blocker: { choice: 'none', probabilities: { none: 1 } }, who: { choice: 'unstated', probabilities: { unstated: 1 } } }, usage: { input_tokens: 300 } }) };
  };
  const read = await comments.readComments('what is the price\nnice\nboom');
  assert.strictEqual(read.provider, 'jev');
  assert.deepStrictEqual([read.summary.read, read.summary.buyers, read.summary.failed], [3, 1, 1]);
  assert.strictEqual(read.summary.jevInputTokens, 600, 'tokens for this read only');

  console.log('JEV ADAPTER TEST PASSED (offline, canned answers)');
})().catch((err) => {
  console.error('JEV ADAPTER TEST FAILED:', err.message);
  process.exit(1);
});
