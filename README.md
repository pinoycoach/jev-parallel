# Sign-off Agent

Hooks come in. An agent writes ad-copy variations. A gate passes or kills them on its own.
The human sees only the borderline ones, and every call the human makes rewrites the rule file.

Built for ManilaHack (Parallel Distribution), Agents bucket. Text hooks only.

## Start

```
cp .env.example .env     # add ANTHROPIC_API_KEY
node server.js           # http://localhost:3000
```

No install step. Needs Node 18 or newer. With no key it runs in MOCK mode and says so on screen.

## The demo, three beats

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
| Inbox | `public/index.html` | One screen |
| Server | `server.js` | Three endpoints: state, run, call |

Borderline is derived, not asked for: any verdict with confidence under `BORDER` (default 0.75)
goes to the human. With Jev the default is 0.65, which means p(approve) between 0.35 and 0.65.
Jev gives no reasons, so a card's "why" is the skill-file rules Jev doubts, with their numbers. A gate batch that errors goes to the human too. It is never silently passed.

## Honesty rules built in

- Counts come from the run. Nothing on screen is hard-coded.
- MOCK mode, placeholder calls and placeholder seeds each raise a yellow badge.
- The last run is cached in `data/run.json`. After a restart it loads as a labelled REPLAY.
- The gate's guess is not sent to the browser until the human has called.

## Checks

```
node scripts/smoke-test.js   # wiring test in mock mode, no keys, restores files after
node scripts/jev-test.js     # Jev adapter against canned answers, offline
node scripts/noon-test.js    # match rate against calls/holdout.md, bar is 80%
```

## Not done yet

- `adapters/jev.js` is written but has never called the live Jev API. First live run: `TOTAL=20`.
- `calls/calls.md`, `calls/holdout.md` and `seeds/hooks.md` hold placeholders, not Nap's taste.
- Nothing has been run against a live model. Only the mock path and canned Jev answers are tested.
