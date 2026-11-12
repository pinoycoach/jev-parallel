// Thin Claude client. No dependencies; needs Node 18+ (global fetch).
const MODEL = () => process.env.MODEL || 'claude-haiku-5-5';

// APP_CLAUDE_KEY is a second name for the same key. Claude Code cloud environments reserve
// ANTHROPIC_API_KEY for themselves and will not pass it to a session, so use APP_CLAUDE_KEY there.
function apiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.APP_CLAUDE_KEY || '';
}

function hasKey() {
  return Boolean(apiKey());
}

async function ask(prompt, { maxTokens = 4000, system } = {}) {
  if (!hasKey()) throw new Error('ANTHROPIC_API_KEY (or APP_CLAUDE_KEY) is not set');
  const body = {
    model: MODEL(),
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;
  // Rate limits (429) and overloads (5xx) are retried with a growing wait, honouring retry-after.
  // Anything else (bad key, no credit, unknown model) fails at once with the API's own message.
  const ATTEMPTS = 6;
  let lastErr;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err; // network error: retry
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const text = (data.content || []).map((c) => c.text || '').join('');
      if (!text.trim()) throw new Error(`Claude returned no text (stop_reason: ${data.stop_reason || 'unknown'})`);
      return text;
    }
    const text = await res.text().catch(() => '');
    lastErr = new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
    if (res.status !== 429 && res.status < 500) throw lastErr;
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : Math.min(2000 * 2 ** attempt, 20000);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}

// Pull the first JSON array or object out of a model reply.
function extractJson(text) {
  const starts = [text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('No JSON in model reply');
  const start = Math.min(...starts);
  const close = text[start] === '[' ? ']' : '}';
  const end = text.lastIndexOf(close);
  if (end <= start) throw new Error('Unclosed JSON in model reply');
  return JSON.parse(text.slice(start, end + 1));
}

// Run async jobs with a concurrency cap.
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

module.exports = { ask, extractJson, pool, hasKey, MODEL };
