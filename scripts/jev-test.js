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
  assert.strictEqual(body.state, 'Day one I hated it');
  assert.deepStrictEqual(Object.keys(body.questions), ['approve', 'a_1', 'a_2', 'k_1', 'k_2']);
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

  // 4. Through the gate with a fake fetch: statuses, auth header, one failure routed to the human.
  const canned = { 'clear pass': 0.93, 'clear kill': 0.06, 'on the edge': 0.55 };
  let sawAuth = false;
  global.fetch = async (_url, opts) => {
    sawAuth = opts.headers.Authorization === 'Bearer test-key-not-real';
    const hook = JSON.parse(opts.body).state;
    if (hook === 'server says no') return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers: { approve: { noul: canned[hook] } }, usage: { input_tokens: 50 } }) };
  };
  assert.strictEqual(gate.border(), 0.65, 'Jev uses the 0.35 to 0.65 band by default');
  const res = await gate.screen(['clear pass', 'clear kill', 'on the edge', 'server says no'], skill, calls);
  assert.deepStrictEqual(res.map((r) => r.status), ['pass', 'kill', 'borderline', 'borderline']);
  assert.strictEqual(res[2].lean, 'pass');
  assert.ok(res[3].reason.startsWith('gate error'), 'a failed hook goes to the human with the error shown');
  assert.ok(sawAuth, 'bearer key sent');
  assert.strictEqual(jev.tokensUsed(), 150, 'input tokens are counted');

  console.log('JEV ADAPTER TEST PASSED (offline, canned answers)');
})().catch((err) => {
  console.error('JEV ADAPTER TEST FAILED:', err.message);
  process.exit(1);
});
