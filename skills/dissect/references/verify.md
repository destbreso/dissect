# Verify

A figure is done when its audit passes, when it has been looked at in a real browser at every size and theme, and when its lesson has been checked by doing what the caption tells the reader to do. Read every PNG you make: a check you did not look at is not a check.

## The audit

```sh
node examples/<name>/build.mjs --audit          # or: node scripts/build.mjs model.mjs --audit [--strict]
```

It must end `audit passed`. It checks:

- **The model**: everything `validate` checks (errors stop the build).
- **The drawing, level by level**: parts that overlap; a route through a part (an error); a route over a part's words; two routes run on top of each other for more than a few pixels without sharing a port; tags that cover a part, words or another tag; words that sit on a part; names cut short; a level wider than about 1180 px; more than 8 steps on a level; empty lanes; how often routes cross.
- **The run, on the model's seed and seven more**: nothing reaches an end; items still inside when nothing is left to happen; a step busy 95% or more (its queue grows without limit); a route no item takes (unless marked `seldom`); a choice whose observed split is far from its `p` (a check on the simulator itself); a run so long the page will be heavy.
- **The claims**: each must hold on the figure's seed (an error otherwise), and on most seeds (a warning says when a claim is luck).

Fix warnings in the model or the floor plan; leave one only when you know why it stays, and say it in the prose if the reader should know too.

## The visual check

```sh
node examples/<name>/build.mjs --audit --check      # or: node scripts/check.mjs page.html [--out shots/] [--strict]
```

It must end `check passed`. Where the audit estimates text widths, the check measures them in headless Chrome, on every level of every figure on the page, in light and dark at 1280 px and on the top level at 390 px:

- every word on a plate stays inside it, and words never overlap each other, inside a part or out;
- words outside a plate sit clear of every other part, every tag and every rail (the rails are sampled every few pixels);
- tags do not cover parts or each other;
- every word in the drawing and in the card has the contrast WCAG AA asks for against what is behind it;
- the page never scrolls sideways (the drawing may, inside its card, and the check notes it);
- the figure plays, follows an item and takes a what-if, and the console stays clean.

It writes a picture of every level it looked at (`<figure>-<level>-<desktop|phone>-<theme>.png`) next to the page in `shots/`. A passed check is not a review: read the pictures (step 8 of the workflow).

## Captures

```sh
node scripts/capture.mjs page.html --out shots/desk.png                         # 1280 x 900, the card
node scripts/capture.mjs page.html --width 390 --height 844 --out shots/phone.png
node scripts/capture.mjs page-dark.html --out shots/dark.png                     # or --theme dark on an auto page
node scripts/capture.mjs page.html --reduced --out shots/still.png
node scripts/capture.mjs page.html --wait 8000 --times 2000,4000 --out shots/run.png
node scripts/capture.mjs page.html --zoom 300,120,240,140 --out shots/close.png  # a close-up, 4x
```

Every capture prints the readout, console errors and exceptions, and whether the page scrolls sideways. A capture with console errors exits 2.

## Driving

```sh
node scripts/drive.mjs page.html --actions steps.json
```

```json
[
  ["call", "fig.setSpeed(8)"],
  ["until", "fig.state().clock > 120", 30000],
  ["part", "review"],
  ["call", "fig.inject({ part: 'review', set: { servers: 0 } })"],
  ["wait", 4000],
  ["expect", "fig.replay.st.get('review').queue.length >= 3", "an outage makes the review queue grow"],
  ["part", "ci"],
  ["wait", 900],
  ["expect", "fig.state().view === 'ci'", "clicking CI opens it"],
  ["key", "Escape"],
  ["token"],
  ["expect", "fig.state().followed != null", "clicking a dot follows it"],
  ["shot", "shots/follow.png"]
]
```

Actions: `wait`, `click` (a selector, at fractions of its box), `part` (click a part by path), `token` (click the first drawn dot), `key`, `call` and `eval` (with `fig`, the figure's handle), `until`, `expect`, `state`, `shot`. An `expect` that is false, an `until` that times out, or a console error fails the run.

## The checklist

0. **The check passed**, and you have read its pictures.
1. **The lesson.** Do what the caption says (the what-if, on the step it names) and watch it happen. The queue grows where it says, the number moves the way it says. If not, the model or the caption is wrong; fix the model first.
2. **Every level.** Open each window. Each level reads alone: its numbers are its own, its parts have room, its time scale lets you see its steps.
3. **Following.** Follow an item from its start to its end, through every level it enters. Its journey in the inspector matches what you saw.
4. **The drawing at 1280 px and at 390 px**, light and dark. No word on a rail, no tag on a part, no cut name, no route that crosses a part. On a phone the stage scrolls sideways inside its card; the page itself must not.
5. **The layers.** Time: the longest orange bar is the step the caption names. Failures: the red rails are the ones that carry failed work.
6. **Keyboard.** Tab to every part; Enter opens; Escape closes; Space pauses. The labels read as sentences.
7. **Reduced motion.** The figure opens still and readable; Step and Play work.
8. **The console is clean.**

## Common faults

| Fault | Fix |
|---|---|
| The what-if barely moves anything | The step had too much room. Raise the load or lower the capacity until the base run is busy 60% to 90% there; re-measure. |
| A claim holds on the figure's seed but not on most seeds | The seed was lucky. Pick a seed near the median, or soften the claim. |
| A route through a part, or a long route across the figure | Move the part, or the end it goes to, next to its source; put rework above or below the step that rejects. |
| Two routes on top of each other | Give the parts different rows; a round trip between two steps is drawn as two parallel lines on their top and bottom. |
| A name is cut | A shorter label; the `about` says the rest. |
| A level is too wide | Move steps into a station's `inside`, or fold a sequence into a serpentine (two rows, the second flowing back). |
| Nothing visible happens on a level | Its time scale: set `levelPace` (or `figure.pace` for the top level). |
| Items vanish into a step | They are in work: they sit in its bays, or in its window when it has an inside. Follow one to see. |
| The utilization reads above 100% | Stats taken before the run reached that time. Use `createSim(def).runUntil(t).stats()`. |
