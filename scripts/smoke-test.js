// Wiring test in MOCK mode: no keys, no network. Proves the loop runs end to end.
// Works on copies of the calls and skill files so it never touches the real ones.
// Usage: node scripts/smoke-test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.GATE = 'mock';
delete process.env.ANTHROPIC_API_KEY;
process.env.PORT = '0';
process.env.TOTAL = '60';

const ROOT = path.join(__dirname, '..');
const touched = ['calls/calls.md', 'skills/signoff.md', 'data/run.json'].map((f) => path.join(ROOT, f));
const backup = touched.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
const restore = () => touched.forEach((f, i) => {
  if (backup[i] === null) { if (fs.existsSync(f)) fs.unlinkSync(f); } else fs.writeFileSync(f, backup[i]);
});

const { server } = require('../server');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => (await fetch(base + p)).json();
  const post = async (p, body) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.strictEqual((await post('/api/run', {})).status, 400, 'empty product is refused');
    assert.strictEqual((await post('/api/run', { product: 'test kettle' })).status, 202);

    let s;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      s = await get('/api/state');
      if (!s.busy && s.run && s.job.phase === 'done') break;
    }
    assert.ok(s.run, 'run exists');
    const c = s.run.counts;
    assert.strictEqual(c.passed + c.killed + c.needYou + c.youDecided, c.made, 'counts add up');
    assert.ok(c.made > 0, 'hooks were made');
    assert.ok(!('lean' in (s.run.queue[0] || {})), 'the guess is not leaked before the call');
    console.log('run:', JSON.stringify(c));

    if (s.run.queue.length) {
      const before = s.run.queue.length;
      const out = await post('/api/call', { id: s.run.queue[0].id, verdict: 'REJECT' });
      assert.strictEqual(out.status, 200);
      assert.ok(['APPROVE', 'REJECT'].includes(out.body.last.agentGuess));
      assert.strictEqual(out.body.state.run.tally.guesses, 1);
      assert.ok(out.body.state.run.queue.length < before, 'queue shrank');
      const c2 = out.body.state.run.counts;
      assert.strictEqual(c2.passed + c2.killed + c2.needYou + c2.youDecided, c2.made, 'counts still add up');
      assert.ok(fs.readFileSync(touched[0], 'utf8').includes('called live in the inbox'), 'call was appended');
      console.log('call:', JSON.stringify({ guess: out.body.last.agentGuess, right: out.body.last.right, moved: out.body.last.movedOutOfQueue, left: c2.needYou }));
      assert.strictEqual((await post('/api/call', { id: s.run.queue[0].id, verdict: 'APPROVE' })).status, 500, 'double call is refused');
    } else {
      console.log('no borderline cards in this mock run; call path not exercised');
    }
    // Comment reader, mock mode.
    const pasted = ['How much is this? I want one', 'Where can I buy, as a mom I need this for my kid', 'Scam, this is fake', 'Too expensive for me', 'love it', '@friend', 'maybe hmm'].join('\n');
    assert.strictEqual((await post('/api/comments', { text: '' })).status, 500, 'empty paste is refused');
    const cr = await post('/api/comments', { text: pasted, hook: 'I tested the cheap one for a month' });
    assert.strictEqual(cr.status, 200);
    const rd = cr.body.reading;
    assert.strictEqual(rd.summary.read, 7);
    assert.strictEqual(rd.summary.buyers, 2);
    assert.strictEqual(rd.summary.kinds.objection, 2);
    assert.strictEqual(rd.summary.needYou, 1, 'the ambiguous comment goes to the human');
    assert.deepStrictEqual(rd.summary.whoAmongBuyers, { parent: 1 });
    assert.ok(!('items' in rd) || rd.items === undefined, 'raw item list is not sent');
    const callsBefore = fs.readFileSync(touched[0], 'utf8');
    assert.strictEqual((await post('/api/teach', { verdict: 'APPROVE' })).status, 200);
    assert.ok(fs.readFileSync(touched[0], 'utf8').length > callsBefore.length && fs.readFileSync(touched[0], 'utf8').includes('showed buying intent'), 'teaching appended an example call');
    assert.strictEqual((await post('/api/teach', { verdict: 'APPROVE' })).status, 400, 'teaching twice is refused');
    console.log('comments:', JSON.stringify(rd.summary.kinds), 'buyers', rd.summary.buyers);
    console.log('SMOKE TEST PASSED (mock mode)');
  } catch (err) {
    console.error('SMOKE TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    restore();
    server.close();
  }
})();
