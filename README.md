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

## Run it in 30 seconds

Needs Node 18 or newer. There is nothing to install.

```
git clone https://github.com/pinoycoach/jev-parallel
cd jev-parallel
node server.js
```

Open http://localhost:3000.

- **With no keys it runs in MOCK mode**, and yellow badges say so. Mock mode uses keyword rules
  and canned wording. It shows the flow, not the models.
- **Tab 1, "Who are they?":** paste the lines from `samples/comments.txt` (sixteen invented
  comments, written for testing) or the comments from any real post, then press Read them.
- **Tab 2, sign-off:** name a product and press Make 200 hooks, or open "paste your own hooks"
  and screen copy you already have. `samples/hooks.txt` holds twenty test hooks that Nap rated in
  advance and held back, so the gate has never seen them (his verdicts are in `calls/holdout.md`).
  Approve or reject the cards.

For the real models, copy `.env.example` to `.env` and fill in two keys:

```
ANTHROPIC_API_KEY=   # writes the hooks and compiles the skill file
TYPESAFE_API_KEY=    # Jev, the judging model
GATE=jev
```

`.env` is git-ignored. No key is stored in this repo.

## The demo

Tab 1 first: a judge pastes the comments from any real post and taps Read. Then tab 2:

1. A judge names any product. 200 hooks are written and screened. The top line shows the real counts.
2. Only the borderline cards appear, each with why the gate is unsure. The gate's guess is locked.
3. The judge taps Approve or Reject. The guess is revealed, the skill file rewrites on the right
   (new lines in green), and the queue re-sorts. A running tally shows how often it guessed the judge.

The live writer is told to produce a batch of mixed quality on purpose: about a third strong, a
third flat, a third the hype and overpromising a strict editor rejects. That is what raw output
looks like at volume, and it gives the gate real work. The page says so on the writer badge.

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
goes to the human. With Jev the default is 0.70, which means p(approve) between 0.30 and 0.70. A hook that would pass but shows a child using the product also goes to the human.
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

## Known limits

- Live runs so far are Nap's own, on 12 Nov 2026, and are recorded in CLAUDE.md under Decisions.
  The gate matched his held-back calls on 16 of 20 hooks, after tuning on those same 20.
- Jev is English-first. A few common Tagalog shopping phrases read correctly in a small test,
  helped by a hint in the question. Longer or slangier Tagalog and Taglish is untested.
- "Want to buy" was written for post comments. On product reviews it mostly finds repeat buyers.
- The gate is a coarse filter. It kills hype and claims and asks about close calls, but it still
  passes some hooks Nap rejected. It does not yet tell a good personal hook from a weak one.
- Hype bolted onto an approved structure still passes. On a hosted run of 200 on 13 Nov, about
  14 of 128 passed hooks were of this kind ("Limited stock, folks. I bought these to prove my mom
  wrong."). They score as high as clean hooks, so moving the line does not catch them.
- The child check asks too often. It sent "Then my son left this gummy on my desk" to the human
  (an adult son giving it), while a near-identical line passed in another run.
- The ask-a-human line (0.70) was set from one run. On the next run the human was asked about 16%
  of hooks, above the 5 to 10% this project aimed for.
- The automated tests cover mock mode and canned Jev answers only.

Next step, not built: when a hook passes on style but strongly hits one of the human's own kill
rules, send it to the human. The rule file already flags these (the "Limited stock" hook scored
0.91 on the urgency rule); today the rules only explain a verdict and never route one.

## Hosting it (Google Cloud Run)

The app runs as it is in a container (`Dockerfile`). Three things differ from a laptop:

- **Password and cap.** Set `APP_PASSWORD` and `DAILY_CAP`. On Cloud Run the server refuses to
  start without a password, because anyone with the link could otherwise spend the API keys.
- **Keys** go in Secret Manager and are attached to the service as environment variables
  (`TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`, `APP_PASSWORD`). Never in the repo.
- **One instance, CPU always on.** The run is held in memory and continues after the page's
  request returns, so deploy with `--max-instances 1 --no-cpu-throttling`.

```
gcloud run deploy who-are-they --source . --region asia-southeast1 \
  --max-instances 1 --no-cpu-throttling --allow-unauthenticated \
  --set-env-vars GATE=jev,DAILY_CAP=20 \
  --set-secrets TYPESAFE_API_KEY=typesafe-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,APP_PASSWORD=app-password:latest
```

Limits of the hosted copy: everyone who logs in shares one screen (one run, one comment read at a
time), and calls taught on the page are lost when the instance restarts, which returns it to the 30
calls in `calls/calls.md`.
