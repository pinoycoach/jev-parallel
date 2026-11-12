// Sign-off Agent: hooks in, gate screens them, the human sees only the borderline ones.
// Zero dependencies. Start with: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- .env loader (no dependency) ----
const ENV = path.join(__dirname, '.env');
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { readCalls, appendCall, readSeeds } = require('./lib/calls');
const generator = require('./lib/generator');
const gate = require('./lib/gate');
const skill = require('./lib/skill');
const comments = require('./lib/comments');

const DATA = path.join(__dirname, 'data');
const RUN_FILE = path.join(DATA, 'run.json');
const PORT = Number(process.env.PORT) || 3000;
const TOTAL = Number(process.env.TOTAL) || 200;

let run = null; // the current or last run
let job = { phase: 'idle', done: 0, total: 0, error: null };
let busy = false;
let reading = null; // the last comment read: { hook, taught, ...result }
let readingBusy = false;
let skillError = null; // why the rule file was not updated on the last compile, if it was not

// Load the cached run so the demo can replay if the network dies. It is labelled as a replay.
if (fs.existsSync(RUN_FILE)) {
  try {
    run = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
    run.replay = true;
  } catch (_) {
    run = null;
  }
}

function saveRun() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));
}

function counts() {
  if (!run) return null;
  const c = { made: run.items.length, passed: 0, killed: 0, needYou: 0, youDecided: 0 };
  for (const it of run.items) {
    if (it.human) c.youDecided += 1;
    else if (it.status === 'pass') c.passed += 1;
    else if (it.status === 'kill') c.killed += 1;
    else c.needYou += 1;
  }
  return c;
}

function publicState() {
  const calls = readCalls();
  const seeds = readSeeds();
  const queue = run ? run.items.filter((it) => it.status === 'borderline' && !it.human) : [];
  // The agent's guess (lean) is NOT sent for the queue. It is revealed only after the human calls.
  const strip = (it) => ({ id: it.id, hook: it.hook, pattern: it.pattern, confidence: it.confidence, reason: it.reason });
  return {
    job,
    busy,
    providers: { gate: gate.provider(), generator: generator.provider(), border: gate.border() },
    warnings: {
      placeholderCalls: calls.filter((c) => c.placeholder).length,
      placeholderSeeds: seeds.filter((s) => s.placeholder).length,
      totalCalls: calls.length,
      totalSeeds: seeds.length,
    },
    run: run && {
      product: run.product,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      replay: Boolean(run.replay),
      providers: run.providers,
      counts: counts(),
      queue: queue.map(strip),
      passed: run.items.filter((it) => it.status === 'pass' && !it.human).map((it) => ({ hook: it.hook, reason: it.reason })),
      killed: run.items.filter((it) => it.status === 'kill' && !it.human).map((it) => ({ hook: it.hook, reason: it.reason })),
      tally: run.tally,
      last: run.last || null,
    },
    skill: skill.readSkill(),
    skillError,
    reading: reading && { ...reading, items: undefined },
    readingBusy,
  };
}

// Lines pasted by a person: one hook per line, bullets and numbering stripped.
function parsePasted(text) {
  const seen = new Set();
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length >= 8 && l.length <= 300)
    .filter((l) => (seen.has(l.toLowerCase()) ? false : seen.add(l.toLowerCase())))
    .slice(0, 300);
}

async function startRun(product, pastedText) {
  const pasted = parsePasted(pastedText);
  const seeds = readSeeds();
  if (!pasted.length && !seeds.length) throw new Error('seeds/hooks.md has no patterns');
  busy = true;
  job = { phase: 'compiling the skill file', done: 0, total: 1, error: null };
  try {
    const calls = readCalls();
    const compiled = await skill.compile(calls);
    skillError = compiled.error || null;

    let gen;
    if (pasted.length) {
      // The human supplied the hooks. Nothing is written by a model in this run.
      gen = { items: pasted.map((hook) => ({ hook, pattern: 'pasted in' })), provider: 'pasted' };
    } else {
      job = { phase: 'writing hooks', done: 0, total: seeds.length, error: null };
      gen = await generator.generate({
        product, seeds, total: TOTAL,
        onProgress: (d, t) => { job.done = d; job.total = t; },
      });
    }
    if (!gen.items.length) throw new Error('generator returned no hooks');

    job = { phase: 'screening', done: 0, total: gen.items.length, error: null };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const results = await gate.screen(gen.items.map((i) => i.hook), compiled.text, calls, (d, t) => { job.done = d; job.total = t; });

    run = {
      product,
      startedAt,
      finishedAt: new Date().toISOString(),
      screenSeconds: Math.round((Date.now() - t0) / 100) / 10,
      replay: false,
      providers: { gate: gate.provider(), generator: gen.provider },
      items: gen.items.map((it, i) => ({ id: i + 1, ...it, ...results[i], human: null })),
      tally: { guesses: 0, right: 0 },
      last: null,
    };
    saveRun();
    if (gate.provider() === 'jev') console.log(`Jev input tokens used so far: ${require('./adapters/jev').tokensUsed()}`);
    job = { phase: 'done', done: 1, total: 1, error: null };
  } catch (err) {
    job = { phase: 'error', done: 0, total: 0, error: err.message };
    console.error('run failed:', err);
  } finally {
    busy = false;
  }
}

async function humanCall(id, verdict, why) {
  if (!run) throw new Error('no run yet');
  const item = run.items.find((it) => it.id === id);
  if (!item) throw new Error('unknown card');
  if (item.human) throw new Error('already called');
  busy = true;
  try {
    item.human = verdict;
    const guessedApprove = item.lean === 'pass';
    const right = guessedApprove === (verdict === 'APPROVE');
    run.tally.guesses += 1;
    if (right) run.tally.right += 1;

    appendCall({ verdict, hook: item.hook, why });
    const calls = readCalls();
    const compiled = await skill.compile(calls);
    skillError = compiled.error || null;

    // Re-screen what is still waiting, with the updated skill file. Some cards leave the queue.
    const waiting = run.items.filter((it) => it.status === 'borderline' && !it.human);
    let moved = 0;
    if (waiting.length) {
      const results = await gate.screen(waiting.map((w) => w.hook), compiled.text, calls);
      waiting.forEach((w, i) => {
        Object.assign(w, results[i]);
        if (w.status !== 'borderline') moved += 1;
      });
    }
    run.last = {
      hook: item.hook,
      yourCall: verdict,
      agentGuess: guessedApprove ? 'APPROVE' : 'REJECT',
      right,
      confidence: item.confidence,
      diff: compiled.diff,
      movedOutOfQueue: moved,
    };
    saveRun();
    return run.last;
  } finally {
    busy = false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 3e5) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('bad JSON')); }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, publicState());
    if (req.method === 'POST' && req.url === '/api/run') {
      if (busy) return send(res, 409, { error: 'busy' });
      const body = await readBody(req);
      const hooksText = String(body.hooks || '');
      const product = String(body.product || '').trim().slice(0, 120) || (parsePasted(hooksText).length ? 'pasted hooks' : '');
      if (!product) return send(res, 400, { error: 'name a product, or paste hooks to screen' });
      startRun(product, hooksText); // runs in the background; the page polls /api/state
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/call') {
      if (busy) return send(res, 409, { error: 'busy' });
      const body = await readBody(req);
      const verdict = body.verdict === 'APPROVE' ? 'APPROVE' : body.verdict === 'REJECT' ? 'REJECT' : null;
      if (!verdict) return send(res, 400, { error: 'verdict must be APPROVE or REJECT' });
      const last = await humanCall(Number(body.id), verdict, String(body.why || '').slice(0, 200));
      return send(res, 200, { last, state: publicState() });
    }
    // After posting: read pasted comments. Nothing is fetched from any platform.
    if (req.method === 'POST' && req.url === '/api/comments') {
      if (readingBusy) return send(res, 409, { error: 'busy' });
      const body = await readBody(req);
      readingBusy = true;
      try {
        const result = await comments.readComments(String(body.text || ''));
        reading = { hook: String(body.hook || '').trim().slice(0, 300), taught: null, at: new Date().toISOString(), ...result };
        if (result.provider === 'jev') console.log(`comment read: ${result.summary.read} comments, ${result.summary.jevInputTokens} Jev input tokens, ${result.summary.seconds}s`);
      } finally {
        readingBusy = false;
      }
      return send(res, 200, publicState());
    }
    // Close the loop: the human turns what the comments showed into an example call for the gate.
    if (req.method === 'POST' && req.url === '/api/teach') {
      if (busy) return send(res, 409, { error: 'busy' });
      const body = await readBody(req);
      const verdict = body.verdict === 'APPROVE' ? 'APPROVE' : body.verdict === 'REJECT' ? 'REJECT' : null;
      if (!verdict) return send(res, 400, { error: 'verdict must be APPROVE or REJECT' });
      if (!reading || !reading.hook) return send(res, 400, { error: 'no hook was given with the last comment read' });
      if (reading.taught) return send(res, 400, { error: 'already taught from this read' });
      const sm = reading.summary;
      const why = `comments: ${sm.buyers} of ${sm.read} showed buying intent, ${(sm.kinds.objection || 0)} objected (read by ${reading.provider})`;
      appendCall({ verdict, hook: reading.hook, why });
      reading.taught = verdict;
      busy = true;
      try { const c = await skill.compile(readCalls()); skillError = c.error || null; } finally { busy = false; }
      return send(res, 200, publicState());
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Sign-off Agent on http://localhost:${PORT}`);
    console.log(`gate: ${gate.provider()} | generator: ${generator.provider()} | borderline under ${gate.border()}`);
  });
}

module.exports = { server };
