// Generator: hook patterns in, fresh ad-copy variations out.
// Same structure as the pattern, new wording. Never the source copy word for word.
const { ask, extractJson, pool, hasKey } = require('./llm');

function provider() {
  return hasKey() ? 'claude' : 'mock';
}

// Turn a model reply into hooks. Accepts a JSON array, or plain lines (numbered, bulleted or bare).
function parseHooks(text, n) {
  let arr = null;
  try {
    const j = extractJson(text);
    if (Array.isArray(j)) arr = j;
  } catch (_) { /* not JSON: fall through to lines */ }
  if (!arr) {
    arr = String(text).split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”],?$/g, '').trim())
      .filter((l) => l.length >= 12 && l.length <= 220 && !/[:：]$/.test(l));
  }
  return arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, n);
}

async function claudeVariations(pattern, product, n) {
  const prompt = `This is an internal screening exercise. Nothing you write is published. A separate gate will reject most of these lines, and a person reviews the rest.

Write ${n} candidate opening lines ("hooks") for a short product video.

Product: ${product}
Hook pattern (structure only): ${pattern}

Follow the STRUCTURE of the pattern with completely fresh wording.
Rules:
- 6 to 16 words each, plain spoken language. Two short sentences are fine if the pattern has two.
- First-person lines are draft scripts for a real creator to adapt to their own true experience. Do not present them as real reviews.
- Vary the angle: some bold, some quiet, some specific, some risky. A real range, including weak ones a strict editor would kill.
- No health cures, no medical claims, no guaranteed results, no statistics.

Output exactly ${n} lines, one hook per line. No numbering, no quotes, no commentary before or after.`;
  const text = await ask(prompt, { maxTokens: 1500 });
  const hooks = parseHooks(text, n);
  if (!hooks.length) throw new Error(`the model wrote no usable hooks. It said: "${String(text).replace(/\s+/g, ' ').slice(0, 180)}"`);
  return hooks;
}

// Offline stand-in so the wiring can be tested with no key. Output is crude on purpose
// and the UI labels the run MOCK.
const MOCK_TWISTS = [
  'Nobody warned me about', 'I was wrong about', 'Three weeks in with', 'The honest truth about',
  'Stop scrolling if you use', 'My mother laughed at', 'I almost returned', 'What they hide about',
  'Day one versus day thirty of', 'I tested the cheap version of', 'Why I quit and came back to',
  'The mistake everyone makes with', 'Read this before you buy', 'I did not expect this from',
  'Unpopular opinion on', 'Here is what changed after', 'The quiet reason people keep', 'I timed myself using',
  'Ask anyone who owns', 'This is the last thing I say about',
];

function mockVariations(pattern, product, n, offset) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const twist = MOCK_TWISTS[(i + offset) % MOCK_TWISTS.length];
    out.push(`${twist} ${product} (${pattern.replace(/\[PLACEHOLDER\]/g, '').trim().slice(0, 40)})`);
  }
  return out;
}

async function generate({ product, seeds, total = 200, onProgress = () => {} }) {
  const per = Math.ceil(total / seeds.length);
  const mode = provider();
  let done = 0;
  let firstError = null;
  // Low concurrency by default: a new API account has tight per-minute limits.
  const lanes = Math.max(1, Number(process.env.GEN_CONCURRENCY) || 2);
  const groups = await pool(seeds, lanes, async (seed, idx) => {
    let hooks;
    if (mode === 'claude') {
      try {
        hooks = await claudeVariations(seed.pattern, product, per);
      } catch (err) {
        hooks = [];
        if (!firstError) firstError = err.message;
        console.error('generator: pattern failed:', seed.pattern, err.message);
      }
    } else {
      hooks = mockVariations(seed.pattern, product, per, idx * 3);
    }
    done += 1;
    onProgress(done, seeds.length);
    return hooks.map((hook) => ({ hook: hook.trim(), pattern: seed.pattern }));
  });
  const seen = new Set();
  const flat = [];
  for (const g of groups) {
    for (const item of g) {
      const key = item.hook.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(item);
    }
  }
  // Say why, so the page shows the cause and not just an empty result.
  if (!flat.length && firstError) throw new Error(`the hook writer failed: ${firstError.slice(0, 220)}`);
  return { items: flat.slice(0, total), provider: mode };
}

module.exports = { generate, provider, parseHooks };
