// Jev adapter. NOT WIRED YET.
//
// To wire it: copy the gate call from the private repo voice-lab-jev into judgeBatch below.
// Copy the gate logic only. Do not copy the writing set or any eval data.
//
// Contract (must match lib/gate.js):
//   judgeBatch(hooks: string[], skillText: string, calls: {verdict, hook, why}[])
//     -> Promise<[{ verdict: 'pass' | 'kill', confidence: number 0..1, reason: string }]>
//   One result per hook, same order.
//
// If Jev returns only pass/fail with no score, say so in CLAUDE.md > Decisions and propose how to
// derive confidence (for example: agreement across repeated calls) before building it.
//
// Key goes in .env as JEV_API_KEY. Never commit it.

async function judgeBatch(_hooks, _skillText, _calls) {
  throw new Error('Jev adapter not wired. See adapters/jev.js, or set GATE=claude in .env.');
}

module.exports = { judgeBatch };
