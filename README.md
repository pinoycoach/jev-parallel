# Who are they?

Content is cheap now. Knowing which content brings customers is not. Organic posts carry no ad
tracking, but they carry comments, and at volume nobody reads them.

Two halves, one loop:

1. **After posting, a comment reader.** Paste the comments from a post. Every comment is sorted:
   wants to buy, objects (price, trust, fit), asks, praises, or noise, plus who the commenter
   says they are. Unsure ones go to a human.
2. **Before posting, a sign-off gate.** An agent writes hook variations. A gate passes or kills
   them on its own, judging each against the human's own approved and rejected examples. The
   human sees only the borderline ones.

The loop: after a comment read, one tap adds that post's hook to the gate's examples, so the gate
learns from what customers said, not only from opinion.

Built for ManilaHack (Parallel Distribution), Agents bucket. Text only. The judging model behind
both halves is Jev (TypeSafe), a decision model that returns probabilities, with Claude as a fallback.

## Start

```
cp .env.example .env     # add ANTHROPIC_API_KEY
node server.js           # http://localhost:3000
```

No install step. Needs Node 18 or newer. With no key it runs in MOCK mode and says so on screen.

## The demo

Tab 2 first: a judge pastes the comments from any real post and taps Read. Then tab 1:

1. A judge names any product. 200 hooks are written and screened. The top line shows the real counts.
2. Only the borderline cards appear, each with why the gate is unsure. The gate's guess is locked.
3. The judge taps Approve or Reject. The guess is revealed, the skill file rewrites on the right
   (new lines in green), and the queue re-sorts. A running tally shows how often it guessed the judge.

## How it fits together

| Piece | File | What it does |
|---|---|---|
| Seeds | `seeds/hooks.md` | Hook patterns, structure only |
| Generator | `lib/generator.js` | Fresh wording on each pattern, about 200 hooks |
| Calls | `calls/calls.md` | The human's approve/reject calls with reasons |
| Skill file | `skills/signoff.md` | Compiled from the calls by `lib/skill.js` |
| Gate | `lib/gate.js` | `judgeBatch()` returns verdict, confidence, reason |
| Jev adapter | `adapters/jev.js` | One Jev call per hook. Set `GATE=jev` and `TYPESAFE_API_KEY` |
| Comment reader | `lib/comments.js` | One Jev call per comment: kind, blocker, who |
| Screens | `public/index.html` | Two tabs, one file |
| Server | `server.js` | Five endpoints: state, run, call, comments, teach |

Borderline is derived, not asked for: any verdict with confidence under `BORDER` (default 0.75)
goes to the human. With Jev the default is 0.65, which means p(approve) between 0.35 and 0.65.
With Jev, the verdict comes from the human's example calls, never from the rules. Two things are
killed without a human at 0.8 or above: generic AI copy, and health or guaranteed-result claims.
Jev gives no reasons, so a card's "why" is the skill-file rules Jev doubts, with their numbers. A gate batch that errors goes to the human too. It is never silently passed.

## Honesty rules built in

- Counts come from the run. Nothing on screen is hard-coded.
- MOCK mode, placeholder calls and placeholder seeds each raise a yellow badge.
- The last run is cached in `data/run.json`. After a restart it loads as a labelled REPLAY.
- The gate's guess is not sent to the browser until the human has called.
- Comments are pasted in by a person. Nothing is scraped or fetched from a platform.
- Buying intent in comments is a signal, not a sale. The page never calls it revenue.
- "Who they say they are" counts only what a commenter states. Nothing is inferred about a person.

## Checks

```
node scripts/smoke-test.js   # wiring test in mock mode, no keys, restores files after
node scripts/jev-test.js     # Jev adapter against canned answers, offline
node scripts/noon-test.js    # match rate against calls/holdout.md, bar is 80%
```

## Not done yet

- `adapters/jev.js` and `lib/comments.js` are written but have never called the live Jev API.
  First live run: `TOTAL=20`, then about 20 pasted comments.
- Jev is English-first. How well it reads Tagalog and Taglish comments is untested.
- `calls/calls.md`, `calls/holdout.md` and `seeds/hooks.md` hold placeholders, not Nap's taste.
- Nothing has been run against a live model. Only the mock path and canned Jev answers are tested.
