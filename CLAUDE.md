# CLAUDE.md

## First thing in this repo

The "How Nap works" and "Additions" sections are not here yet. Nap's first message does it:

> Copy the 'How Nap works' and 'Additions' sections from `pinoycoach/viral-reels-og-aistudio` CLAUDE.md into this repo's CLAUDE.md, add an empty 'Decisions' section, then follow it.

A Decisions section already exists below. Keep it and append to it.

## What this repo is

Closed Loop, a ManilaHack demo: a sign-off gate before posting and a comment reader after. Hard deadline 7 PM Manila, Thu 12 Nov 2026. Effort: pwede na.
Read README.md for the layout.

## What is left, in order

1. Nap fills `seeds/hooks.md`, `calls/calls.md` and `calls/holdout.md` with his own material.
2. Add `ANTHROPIC_API_KEY` to `.env`. Run once live and fix what breaks. Only mock mode is tested.
3. `adapters/jev.js` and `lib/comments.js` are written but untested live. Set `GATE=jev`,
   `TYPESAFE_API_KEY` and `TOTAL=20`, run once, read the token count in the server log, fix what
   breaks. Then paste about 20 real comments into tab 2 and read the result yourself: are the
   "want to buy" ones right? Tagalog and Taglish comments are the risk (Jev is English-first).
   If Jev misreads them, `GATE=claude` reads comments too. Only then run the full 200.
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
- 2026-11-12: Jev adapter. Jev returns a probability per yes/no question and no reasons. One
  overall question gives p(approve); one question per skill-file rule supplies the "why". Band:
  p between 0.35 and 0.65 goes to the human (`JEV_BORDER`), a starting guess. Key name is
  `TYPESAFE_API_KEY`. Only the call shape came from voice-lab-jev; no writing set, no eval data.
- 2026-11-12: Jev's voice eval has no recorded pass (first same-author test failed on position
  bias; the retest has no result on file). The noon test on Nap's holdout hooks decides the gate.
- 2026-11-12: Pivot to one loop, two halves (Nap's go). Headline is the comment reader: organic
  posts have no ad tracking, but they have comments, and nobody reads them at volume. The gate is
  the second half. Reason: sign-off is a pain Parallel is already hiring for; proof that views
  become customers is the one no role owns. That second claim is inferred from their site, not
  stated on it.
- 2026-11-12: Jev gate verdict now comes from examples, not rules. The state carries the human's
  approved and rejected calls (up to `JEV_EXAMPLES` per side) and one question asks which group
  the hook is closer to. Rule questions stay only as the "why". Reason: in voice-lab-jev, scoring
  against written rules ranked AI copies above the real writing on 14 of 14 pairs, while
  comparing against real examples leaned the right way.
- 2026-11-12: Two auto-kills in the Jev gate, threshold `JEV_KILL` 0.8 (a starting guess):
  generic AI copy, and a health or guaranteed-result claim. Parallel's shown clients are
  supplement, wellness and telehealth brands.
- 2026-11-12: Comment reader takes pasted comments only. No scraping, no platform API. One Jev
  call per comment with three choice questions (kind, blocker, who). A comment whose top "kind"
  probability is under 0.5 goes to the human. "Who" counts only what commenters state.
- 2026-11-12: The loop is closed by a human tap, not automatically. After a comment read, the
  human may add that post's hook to calls.md as an APPROVE or REJECT example, with the comment
  numbers as the why. Reason: comment share is evidence, not proof of sales.
- 2026-11-12: First live runs. Noon test, Jev gate: 15 of 20, then 16 of 20 after asking the
  approve question both ways (tuned on the same 20 hooks, so not a clean test). Claude (Haiku) as
  the gate also got 16 of 20 with the same four misses, but was under the confidence line on all
  20. Jev stays as the gate.
- 2026-11-12: The gate is a coarse filter. It kills hype and claims and passes on-style copy; on
  a live run of 63 written hooks it passed 60 and killed none, because the writer is told to
  avoid hype. Tab 2 now also takes pasted hooks, so it can screen a real mix of copy.
- 2026-11-12: The hook writer returned only some patterns on live runs (cause not confirmed;
  the error now quotes the model). Writer concurrency is 2 and rate limits are waited out.
