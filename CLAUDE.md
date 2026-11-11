# CLAUDE.md

## First thing in this repo

The "How Nap works" and "Additions" sections are not here yet. Nap's first message does it:

> Copy the 'How Nap works' and 'Additions' sections from `pinoycoach/viral-reels-og-aistudio` CLAUDE.md into this repo's CLAUDE.md, add an empty 'Decisions' section, then follow it.

A Decisions section already exists below. Keep it and append to it.

## What this repo is

Sign-off Agent, a ManilaHack demo. Hard deadline 7 PM Manila, Thu 12 Nov 2026. Effort: pwede na.
Read README.md for the layout.

## What is left, in order

1. Nap fills `seeds/hooks.md`, `calls/calls.md` and `calls/holdout.md` with his own material.
2. Add `ANTHROPIC_API_KEY` to `.env`. Run once live and fix what breaks. Only mock mode is tested.
3. Wire `adapters/jev.js` from the private repo voice-lab-jev. Gate logic only. No writing set, no
   eval data. Report what Jev returns (score, confidence, or pass/fail only) and how the borderline
   band will be derived. Wait for Nap's yes before building it.
4. Noon: `node scripts/noon-test.js`. Under 80% match, propose swapping the model behind the gate.
   Nap decides.
5. 3 PM feature freeze. 5 PM three clean run-throughs of the three demo beats.

## Guardrails

- Text only. No video, no posting, no social accounts, no scraping.
- Fake nothing. Counts come from a real run. A replay is labelled as a replay.
- Hook patterns carry structure only. Never reuse someone's copy word for word.
- Keys live in `.env`. Never commit them.
- Nap pushes and submits himself.

## Decisions

- 2026-11-12: Zero dependencies (Node http + one HTML file). Reason: one start command, nothing to
  install on a demo laptop.
- 2026-11-12: Gate sits behind `judgeBatch()` with three providers (jev, claude, mock). Reason: the
  Jev eval has no recorded pass, so the model must be swappable at noon without touching the demo.
- 2026-11-12: "Borderline" = confidence under 0.75, set by `BORDER`. The 0.75 is a starting guess,
  not a measured value. Tune it after the first live run so the queue is roughly 5 to 10% of hooks.
- 2026-11-12: The gate's guess is withheld from the browser until the human calls. Reason: the
  reveal is the demo's main beat and must not be readable in dev tools.
- 2026-11-12: A failed gate batch is routed to the human, never passed.
- 2026-11-12: After each human call, only the still-waiting cards are re-screened, not all 200.
  Reason: speed on stage. Passed and killed hooks keep their original verdict for that run.
- 2026-11-12: Default model `claude-haiku-5-5` for speed. Change with `MODEL` in `.env`.
