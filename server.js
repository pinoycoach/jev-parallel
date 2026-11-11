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

const DATA = path.join(__dirname, 'data');
const RUN_FILE = path.join(DATA, 'run.json');
const PORT = Number(process.env.PORT) || 3000;
const TOTAL = Number(process.env.TOTAL) || 200;

let run = null; // the current or last run
let job = { phase: 'idle', done: 0, total: 0, error: null };
let busy = false;

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
  };
}

async function startRun(product) {
  const seeds = readSeeds();
  if (!seeds.length) throw new Error('seeds/hooks.md has no patterns');
  busy = true;
  job = { phase: 'compiling the skill file', done: 0, total: 1, error: null };
  try {
    const calls = readCalls();
    const compiled = await skill.compile(calls);

    job = { phase: 'writing hooks', done: 0, total: seeds.length, error: null };
    const gen = await generator.generate({
      product, seeds, total: TOTAL,
      onProgress: (d, t) => { job.done = d; job.total = t; },
    });
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
      if (data.length > 1e5) reject(new Error('body too large'));
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
      const product = String(body.product || '').trim().slice(0, 120);
      if (!product) return send(res, 400, { error: 'name a product' });
      startRun(product); // runs in the background; the page polls /api/state
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
