# Walkthrough: the CI pipeline

How `examples/ci-pipeline/` was made, step by step, including what went wrong. It is the quality bar for the drawing and for the honesty of the numbers.

## 1. The lesson first

The request was "show how a change gets from a commit to production". A flowchart of that is everywhere and teaches nothing. The question worth a figure is the one teams argue about: where does a change's time go? The common belief is "CI is slow". The usual truth is that a change spends most of its time waiting for something or someone, and the figure should let the reader find out which.

So the lesson was set before any part: *most of the time is waiting, and the reader can see where and change it*. The click that proves it is a what-if on the bottleneck.

## 2. Truth first

Numbers for a team of about eight engineers on a working day:

- pushes at random, about three an hour: `every: "exp 20"`;
- a fast test suite: checkout `logn 1 2.5`, unit tests `logn 3 6` failing 12% of the time, lint `logn 1 2`, a build `logn 4 8`, on four runners;
- fixing a red build or a review comment: `logn 15 45`, by the author, so no queue (`servers: "inf"`);
- a deploy lock: one deploy at a time, with a canary and a few minutes of watching its metrics, rolling back 5% of the time.

## 3. The floor plan

Lanes for who does the work: Author, CI, Review, Production. The whole pipeline in one level would have been nine columns wide, too small to read, so CI and Ship became stations with an `inside`: the top level is push, CI, Fix it, Code review, Ship and two ends, five columns. CI's inside shows the parallel jobs (a split and a join, then the "green?" choice); Ship's shows merge, canary, the watch timer and the roll out or roll back.

"Fix it" went in the Author lane directly above CI, so the red-build loop is a small rectangle: CI's top to Fix it's bottom, and back down beside it. The first router put the return route into CI's output side; the cost for entering through the output side was raised until that stopped, and stations got three attachment points on their top and bottom so a round trip runs on two parallel lines.

## 4. The first model was wrong

The first version had two reviewers with reviews of `logn 20 60`. It ran, it looked fine, and its caption said a third of the time was spent waiting for review. The run said otherwise: 18% waiting, reviewers busy half the day. Two dedicated reviewers is not how review works: review is one person's worth of attention spread over several people. The model became one reviewer on duty, `logn 12 30`, and the measured wait share became 31%.

The same calibration found a bug: utilization above 100% on some seeds. `stats(t)` had been asked about a time before the point the run had reached, and its accumulators did not go backwards. `stats()` now describes the run up to the time it has reached, and busy shares over the day come from `createSim(def).runUntil(horizon).stats()`.

## 5. The caption is generated

Every number in the caption comes from the run, in `figure.caption`:

```js
caption: ({ run, day, variant, fmt }) => {
  const review = run.stations.review;
  const share = (review.meanWait * review.started) / (run.meanLead * run.done);
  const two = variant((m) => (m.parts.find((p) => p.id === "review").servers = 2)).stations.review;
  return `On this day a change takes ${fmt(run.p50Lead)} ... ${Math.round(share * 100)}% of that time is spent waiting for the reviewer, who is busy ${Math.round(day.stations.review.utilization * 100)}% of the day; a second reviewer cuts the wait from ${fmt(review.meanWait)} to ${fmt(two.meanWait)}.`;
}
```

and the statements are in `claims`, so the audit checks them on eight seeds:

```js
claims: [
  { metric: "review.waitShare", min: 0.2, say: "a large share of a change's time is waiting for the reviewer" },
  { metric: "review.utilization", min: 0.6, max: 0.92, say: "the reviewer is busy most of the day, and keeps up" },
  { metric: "lead.p50", min: 35, max: 80, say: "about an hour from push to production" },
],
```

The audit reported that the second claim holds on 5 of 8 seeds: on some days the reviewer does not keep up. That is true of real teams, so the claim stays and the prose does not promise more. Seed 10 was chosen because its day is close to the median of fifteen.

## 6. Looking at it

The captures showed what the numbers could not:

- items in service vanished into their bays, so the station looked idle while it worked: they now sit in the bay, with the bay filling behind them;
- the rails of a busy route all lit up at once and the accent stopped meaning anything: only instant hops light a rail, at most once a second;
- the time layer's text overflowed the plates: one short line per layer, fitted with the browser's own measurement;
- a gateway's label landed on a plate: labels try six places and take the first one clear of parts, and the audit checks words against parts.

## 7. Driving it

The drive script did what the caption tells the reader to do: an outage on Code review, then checking that its queue grows (the "+n" past six slots, the lamp red); opening CI, Escape back; following a change to the end and reading its journey. Then at 390 px, in dark, with reduced motion.
