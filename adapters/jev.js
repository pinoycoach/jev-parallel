// Jev adapter (TypeSafe). The request and answer shapes follow the ones used in the private repo
// voice-lab-jev: POST { model, state, questions } and read answers[key].noul, a probability 0..1.
// Only the call shape was carried over. No writing set and no eval data.
//
// NOT YET RUN AGAINST THE LIVE API. scripts/jev-test.js checks the mapping with a canned response.
// First live run: set TOTAL=20 in .env and watch the token count printed in the server log.
//
// How it judges one hook:
//   - one overall question: would this person approve the hook?  -> p(approve)
//   - one question per rule in the skill file (approve rules and kill rules)
// Jev gives no reasons, so the "why" shown on a card is the rules it doubts, with their numbers.
//
// Env: TYPESAFE_API_KEY (required), JEV_MODEL (default jev-latest), TYPESAFE_BASE_URL,
//      JEV_CONCURRENCY (default 2 per batch).

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_RULES_PER_SIDE = 5;
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

let inputTokens = 0;
const tokensUsed = () => inputTokens;

// Pull the bullet rules out of the skill file's "Approve when" and "Kill when" sections.
function parseRules(skillText) {
  const rules = { approve: [], kill: [] };
  let section = null;
  for (const raw of String(skillText || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('##')) {
      const h = line.toLowerCase();
      section = h.includes('approve') ? 'approve' : h.includes('kill') ? 'kill' : null;
      continue;
    }
    if (section && line.startsWith('- ')) {
      const rule = line.slice(2).trim();
      if (rule && !rule.startsWith('(') && rules[section].length < MAX_RULES_PER_SIDE) rules[section].push(rule);
    }
  }
  return rules;
}

function buildRequest(hook, rules, calls, model) {
  const recent = (verdict) => calls
    .filter((c) => c.verdict === verdict)
    .slice(-4)
    .map((c) => `"${c.hook.slice(0, 90)}"`)
    .join('; ');
  const questions = {
    approve: {
      type: 'noul',
      instructions: (
        'One specific editor would approve this ad hook. ' +
        `Hooks they approved: ${recent('APPROVE') || 'none yet'}. ` +
        `Hooks they rejected: ${recent('REJECT') || 'none yet'}.`
      ).slice(0, 1200),
    },
  };
  rules.approve.forEach((rule, i) => {
    questions[`a_${i + 1}`] = { type: 'noul', instructions: `This ad hook fits this description: ${rule}`.slice(0, 600) };
  });
  rules.kill.forEach((rule, i) => {
    questions[`k_${i + 1}`] = { type: 'noul', instructions: `This ad hook fits this description: ${rule}`.slice(0, 600) };
  });
  return { model, state: hook, questions };
}

function noulP(answer) {
  const v = answer && typeof answer === 'object' ? answer.noul : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const short = (s) => (s.length > 48 ? s.slice(0, 47) + '…' : s);

// Turn Jev's answers into the gate contract: { verdict, confidence, reason }.
function mapResponse(json, rules) {
  const answers = json && typeof json === 'object' ? json.answers : null;
  if (!answers || typeof answers !== 'object') throw new Error('Jev response had no answers');
  const p = noulP(answers.approve);
  if (p === null) throw new Error('Jev answer missing for the approve question');

  // A rule is "in doubt" when it pulls against the overall lean.
  const doubts = [];
  rules.approve.forEach((rule, i) => {
    const rp = noulP(answers[`a_${i + 1}`]);
    if (rp !== null && rp < 0.5) doubts.push({ text: `misses "${short(rule)}" ${rp.toFixed(2)}`, weight: 0.5 - rp });
  });
  rules.kill.forEach((rule, i) => {
    const rp = noulP(answers[`k_${i + 1}`]);
    if (rp !== null && rp > 0.5) doubts.push({ text: `hits kill rule "${short(rule)}" ${rp.toFixed(2)}`, weight: rp - 0.5 });
  });
  doubts.sort((a, b) => b.weight - a.weight);

  const verdict = p >= 0.5 ? 'pass' : 'kill';
  const confidence = Number(Math.max(p, 1 - p).toFixed(2));
  const reason = `Jev p(approve) ${p.toFixed(2)}` + (doubts.length ? ` · ${doubts.slice(0, 2).map((d) => d.text).join('; ')}` : ' · no rule in doubt');
  return { verdict, confidence, reason: reason.slice(0, 160) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callJev(body) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error('TYPESAFE_API_KEY is not set');
  const url = process.env.TYPESAFE_BASE_URL || DEFAULT_URL;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Jev HTTP ${res.status}`);
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Jev HTTP ${res.status} ${text}`.trim()); // 4xx: do not retry
      }
      const json = await res.json();
      const t = json && json.usage && json.usage.input_tokens;
      if (typeof t === 'number') inputTokens += t;
      return json;
    } catch (err) {
      if (/^Jev HTTP 4/.test(err.message)) throw err;
      lastErr = err.name === 'AbortError' ? new Error(`Jev timeout after ${TIMEOUT_MS / 1000}s`) : err;
      if (attempt < MAX_RETRIES) await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Jev call failed');
}

async function judgeBatch(hooks, skillText, calls) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is not set');
  const rules = parseRules(skillText);
  const model = process.env.JEV_MODEL || 'jev-latest';
  const limit = Math.max(1, Number(process.env.JEV_CONCURRENCY) || 2);
  const out = new Array(hooks.length);
  let next = 0;
  async function worker() {
    while (next < hooks.length) {
      const i = next++;
      try {
        out[i] = mapResponse(await callJev(buildRequest(hooks[i], rules, calls, model)), rules);
      } catch (err) {
        // One failed hook goes to the human. It is never passed and never sinks its batch.
        out[i] = { verdict: 'kill', confidence: 0, reason: `gate error: ${String(err.message).slice(0, 90)}` };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, hooks.length) }, worker));
  return out;
}

module.exports = { judgeBatch, parseRules, buildRequest, mapResponse, tokensUsed };
