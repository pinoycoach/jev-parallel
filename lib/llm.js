// Thin Claude client. No dependencies; needs Node 18+ (global fetch).
const MODEL = () => process.env.MODEL || 'claude-haiku-5-5';

function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function ask(prompt, { maxTokens = 4000, system } = {}) {
  if (!hasKey()) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = {
    model: MODEL(),
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        lastErr = new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw lastErr;
      }
      const data = await res.json();
      return (data.content || []).map((c) => c.text || '').join('');
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
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
