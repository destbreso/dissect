# The model

A figure is one JavaScript object: the process, its numbers and what the prose says about them. `kit/model.mjs` fills its defaults (`normalize`) and checks it (`validate`); every error names the part or the route at fault, in a sentence. Everything the figure draws, moves and counts is read from this object, so the picture cannot drift from the truth.

## The top level

```js
export default {
  id: "ci-pipeline",           // lowercase, used for the page's ids
  title: "From commit to production",
  about: "One or two sentences: what this process is.",
  item: "change",              // what one work item is called: "change 7", "a change"
  items: "changes",            // its plural, where it is not item + "s"
  per: 1,                      // how many real items one dot stands for: at 100, a dot is a hundred requests
  unit: "min",                 // ns, us, ms, s, min, h, d, or any word ("tickets")
  seed: 10,                    // the run the figure plays; pick one close to the median
  horizon: 480,                // the last moment a start creates an item; items in flight finish after it
  lanes: [{ id: "dev", label: "Author" }, ...],
  parts: [...],
  routes: [...],
  claims: [...],               // what the prose says about the numbers; the audit checks them
};
```

`per` keeps a figure of a big flow light: at `per: 100` every count the reader sees (the readout, the inspector, the plates) is in real items, and a start's words say its rate ("~10k/s"). A dot's time is the time of each item in it, so use it for items that arrive and are served together, like requests.

`lanes` are the actors, top to bottom. With no lanes, the level has one unnamed lane. A level inside a station has its own `lanes`, `parts` and `routes`, and keeps the unit of the level that holds it.

## Parts

Every part has an `id` (letters, digits, dots, dashes, underscores; unique on its level), a `kind`, a `lane` (default: the first) and `at: [column, row]`. Columns run left to right in time; rows are counted inside the lane, so `at: [3, 1]` is one row under `at: [3, 0]` in the same lane. Columns may be fractional (2.5 sits between 2 and 3) and may skip numbers (a skipped column leaves room). Optional on every part: `label` (what the drawing shows; default the id), `about` (what the inspector says when the reader clicks it), `glyph` (the icon; default guessed from the words), `flip: true` (work enters on the right and leaves on the left: a rework step in a return lane; usually detected), `dials` (settings the reader can choose, below). Any other field you add travels with the part into the page's events (`dissect:select` and `dissect:open` give the part as written), which is how a page links a figure to something else on it, for example a `section` field naming the paragraph that explains the step.

| kind | What it is | Fields |
|---|---|---|
| `start` | Where items come from | `every` (time between arrivals), `first` (time of the first, default 0), `count` (stop after n), `classes` (`{ feature: 0.8, hotfix: 0.2 }`: kinds of items, by weight). Inside a station's process the start takes the item from the station and has no `every` |
| `end` | Where items leave | `outcome` (a label for what ending here means; `"fail"` marks it as failed work) |
| `station` | Where work is done | `servers` (how many at once: a number, or `"inf"` for no limit; default 1, or no limit with `inside`), `work` (how long one item takes), `fail` (chance it comes out failed; it can differ by kind), `failLabel` (how the inspector names a failure: "changes requested"), `patience` (the longest an item waits in its queue before giving up: outcome `timeout`), `capacity` (room in its queue; arrivals beyond it are turned away: outcome `rejected`; `0` means no queue at all), `inside` (a whole process that is its work), `uses` (ids of stores it reads), `scale` (servers that follow the load: autoscaling, below), `switch` (the reader can turn it off) |
| `choice` | An exclusive decision (BPMN XOR): one way out | its routes carry `p` (by chance, which can differ by kind) or `when` (by how the item did); `switch` (the reader can turn it off: everything then takes the route marked `bypass: true`) |
| `split` | Parallel work (BPMN AND): one copy down every route | `fanout: true`: the copies go on alone to their own ends (a message to every subscriber); without it, a `join` must bring them back |
| `join` | Waits for every branch of its split, then goes on as one | the joined item's outcome is the worst of its branches (fail over timeout over rejected over ok) |
| `timer` | Holds each item for a while | `wait` (a backoff, a bake time, an approval window, a retransmission timer) |
| `store` | A database, cache or file that stations use; items never enter it | linked to the stations that list it in `uses` |

A station's `inside` is its work: the item goes in through the inner start, takes whatever path the inner process gives it, and comes out at an inner end; the time inside is the station's work time, and the inner end's outcome (when it is `ok`, `fail`, `timeout` or `rejected`) is the station's outcome. A station with `inside` and finite `servers` is a step that holds that many items at once (a deploy lock is `servers: 1`).

## Durations

Wherever a model takes a duration (`every`, `work`, `wait`, `patience`, `latency`):

| Form | Means | Use it for |
|---|---|---|
| `5` or `"const 5"` | always 5 | machine steps that do not vary |
| `"uni 2 6"` | anywhere from 2 to 6, evenly | a range someone gives you |
| `"exp 20"` | 20 on average, memoryless | arrivals that come at random (people pushing, users clicking) |
| `"logn 12 30"` | median 12, p95 30 | service times: what people know about their own work ("usually 12 minutes, half an hour on a bad day") |
| `"norm 10 2"` | mean 10, sd 2, never below 0 | symmetric variation around a target |
| `"tri 1 2 6"` | between 1 and 6, most often 2 | a three-point estimate |
| `"pick 1 2 2 3"` | one of these, equally likely | a handful of known cases |

The plates print them short ("12 min, p95 30", "2-6 ms", "~20 min"); the inspector says them in words ("median 12 min, p95 30 min").

## Routes

```js
{ id: "retry", from: "build", to: "backoff", when: "fail", max: 2, label: "retry", latency: "uni 1 3", seldom: false }
```

- `from`, `to`: part ids on the same level. `id` defaults to `from>to`; give one when two routes join the same pair, or when a claim or a caption names the route.
- `p`: a probability, on every route out of a choice that decides by chance; they must add up to 1.
- `when`: on routes out of a choice, or out of a station that sorts its own outcomes. One of `ok`, `fail`, `timeout`, `rejected`, `class:<name>` (by the item's kind) or `else`. Routes are tried in order; the first that matches wins.
- `max`: how many times one item may take this route (a retry cap). When it is used up, the next matching route is taken, so a capped route needs a second route for the same `when` (or an `else`).
- `latency`: time on the route itself (the network, a hand-off, a trip down the corridor). The item visibly travels.
- `label`: the tag on the route. Defaults to the `when`, or the `p` as a percentage; `""` for none.
- `seldom: true`: a route the base run rarely or never takes, by design (a timeout path that a what-if exercises). The audit then notes it instead of warning.
- `bypass: true`: on one route out of a choice that has a switch, the way everything goes while the choice is off (a cache turned off sends every request on to the origin).

## Kinds of items

A start's `classes` make kinds of items, each drawn in its own color and listed in the legend. Any chance in the model can then differ by kind: `p` on a choice's routes and `fail` on a station take an object with a chance per kind, and `else` for the kinds it does not name.

```js
{ id: "waf", kind: "station", servers: "inf", work: "const 0.002", fail: { bots: 0.6, else: 0.002 }, failLabel: "blocked" },
{ id: "hit", from: "cache", to: "edge-hit", p: { assets: 0.95, pages: 0.05, bots: 0 } },
{ id: "miss", from: "cache", to: "lb", p: { assets: 0.05, pages: 0.95, bots: 1 } },
```

For every kind, the `p` of a choice's routes must add up to 1; the validation names the kind that does not. Routing by kind with no chance at all is `when: "class:<name>"`.

## Switches and dials

A **switch** is a part the reader can turn off and on again: a firewall rule, a cache, a feature flag, a check. `switch: true` on a station or a choice draws a small switch on it (on its plate; over or under a diamond). Off, a station lets every item straight through (no work, no queue, no failing) and a choice sends everything down its `bypass` route. `switch: { on: false }` starts it off; `switch: { label: "Edge cache" }` names what it turns off where the part's own label is a question; `switch: { off: [{ part, set }] }` says exactly what off changes, for any parts on its level.

A **dial** is a setting with a few options: the size of an attack, how many people come, how far autoscaling may go. A part with dials (or with `scale`) carries a small settings badge, and its settings open in a panel on the figure, next to it, when the reader clicks it (or its badge, for a step that opens into a level): what it is doing now, its dials, and its switch if it has one.

```js
dials: [{ label: "Attack", value: 2, options: [
  { label: "none", set: { paused: true } },
  { label: "2k/s", set: { every: "exp 0.05" } },
  { label: "10k/s" },                                   // the model as written
  { label: "30k/s", set: { every: "exp 0.003333" } },
] }]
```

An option's `set` changes its own part (`changes: [{ part, set }]` changes others on the level). Choosing an option first puts back, as written in the model, every field any of the dial's options sets, then applies its own: so the option without a `set` is the model as written, and `value` is the option a run starts from. What each kind of part can have set: a station `servers`, `work`, `fail`, `patience`, `capacity`, `bypass`, `scale`; a choice `p`, `take` (a route everything takes); a start `every`, `classes`, `paused`; a timer `wait`.

Both apply from the moment the reader moves them, like what-ifs, and the run before stays as it was. A new run starts with them where the reader left them; "Undo what-ifs" puts them all back.

## Autoscaling

```js
{ id: "app", kind: "station", servers: 2, work: "logn 0.3 0.8", patience: 10,
  scale: { min: 2, max: 16, target: 0.6, every: 10, boot: "uni 45 75", cooldown: 60 } }
```

Every `every`, the station looks at the work that arrived since the last look, in servers' worth (arrivals times the mean `work`), and wants enough servers to keep them about `target` busy, between `min` and `max`. It starts the servers it wants more of, each ready after its `boot`; it stops servers it no longer wants once `cooldown` has passed since it last added any. `servers` is what it starts with. A dial can turn it off (`set: { scale: false }`: the servers running stay) or change its limits (`set: { scale: { max: 8 } }`). The drawing has a bay for every server up to `max` (at most 16): running, starting, or not there; its settings panel shows the same as a row of cells, with its policy in words.

## Claims

Every statement the prose makes about the figure's numbers goes in `claims`, so the audit can check it on the figure's seed and on seven more:

```js
claims: [
  { metric: "review.waitShare", min: 0.2, say: "a large share of a change's time is waiting for the reviewer" },
  { metric: "lead.p50", near: 54, tol: 0.2 },
]
```

`min`, `max`, `near` (with `tol`, relative, default 0.15). The metrics:

| Metric | Is |
|---|---|
| `lead.p50`, `lead.p95`, `lead.p99`, `lead.mean` | time from start to end, over every item of the run |
| `done`, `throughput` | items finished; per unit of time over the horizon |
| `outcome.<name>` | share of finished items with that outcome |
| `<station>.utilization` | busy share of its capacity over the horizon |
| `<station>.wait`, `<station>.p95wait` | waiting time in its queue, per item |
| `<station>.waitShare` | share of all items' time spent waiting for it |
| `<station>.timeoutShare`, `<station>.rejectShare`, `<station>.failShare` | of its arrivals, those that gave up or were turned away; of its finished, those that failed |
| `<station>.done` | items it finished |
| `<station>.maxServers` | for a station that scales, the most servers it ran at once |
| `end.<end>` | share of all finished items that ended there |
| `kind.<name>.done`, `kind.<name>.lead.p50`, `kind.<name>.lead.p95` | the same, for one kind of item |
| `kind.<name>.outcome.<outcome>`, `kind.<name>.end.<end>` | share of one kind's items with that outcome, or that ended there |

A station inside another is named by its path: `ci/unit`, `below/dram`.

## The figure export

Next to the model, a module may export `figure`, which `scripts/build.mjs` reads:

```js
export const figure = {
  fig: "Fig 2",
  pace: 25,            // model time per second of playback at 1x; default: a typical item crosses in about 12 s
  speed: 1,            // the speed the page opens at
  outage: 150,         // how long the "Outage" what-if lasts; default: an eighth of the horizon
  burst: 48,           // how long "A burst" lasts; default: a tenth of the horizon
  levelPace: { ci: 2 },  // a level's own pace; default: its typical time inside, over eight
  watch: { class: "pages", label: "pages served", window: 20 },  // the readout's one number: the share of a kind served lately
  caption: ({ run, day, sim, variant, fmt, model }) => `...`,
};
```

`watch` is for a figure whose question is whether something still works: the readout then shows the share of that kind of item that ended well over the last `window`, and its median time.

`caption` writes the caption from the run, so every number in it is generated: `run` is the stats of the whole run (every item followed to its end), `day` the stats at the horizon (busy shares over the period), `sim` the run itself with its `log`, `variant(edit, { changes })` the stats (and `.log`) of a copy of the model after `edit(copy)` and with timed changes, `fmt` a duration for people. Wording that depends on the result is written with the result: if a what-if does not produce the effect, the caption must not say it does.

## Validation messages

`validate(def)` returns `{ errors, warnings }`. Errors stop the build. A few you will meet:

- `choice "approved": the p of its routes add up to 0.9, not 1`
- `split "fork": its branches never meet at one join, so the parallel work is never put back together` (or set `fanout: true` if they should go on alone)
- `station "review" has 2 routes out; put a choice after it, or give every route a when`
- `route retry has max 2; add a second route with when "fail" (or an else) for when the cap is used up`
- `station "build" fails 4% of the time, but no choice after it routes "fail"; failed items carry on as if nothing happened` (a warning)
- `station "fix" cannot reach an end: items would pile up there`

## Recipes

**Rework loop.** The rejecting step sorts its outcomes; the fix happens in the author's lane and goes back through the same queue.

```js
{ id: "review", kind: "station", servers: 1, work: "logn 12 30", fail: 0.15, failLabel: "changes requested", ... },
{ id: "fix", kind: "station", lane: "dev", servers: "inf", work: "logn 15 45", ... },
{ from: "review", to: "merged", when: "ok" }, { from: "review", to: "fix", when: "fail" }, { from: "fix", to: "review" },
```

**Retry with backoff, then a dead-letter queue.**

```js
{ id: "send", kind: "station", servers: 12, work: "logn 120 400", fail: 0.06, ... },
{ id: "backoff", kind: "timer", wait: "uni 200 400", ... },
{ id: "dlq", kind: "end", outcome: "fail", label: "dead letters" },
{ from: "send", to: "sent", when: "ok" },
{ id: "retry", from: "send", to: "backoff", when: "fail", max: 2 },
{ id: "give-up", from: "send", to: "dlq", when: "fail", seldom: true },
{ from: "backoff", to: "send" },
```

**Timeout and escalation.** `patience` on the step; route `timeout` to whoever picks it up next.

**Overflow.** `capacity` on the step, route `rejected` (a full buffer drops the packet; `capacity: 0` refuses at once, like a synchronous call over a concurrency limit).

**Parallel work.** `split` then `join`; the item is as late as its slowest branch. **Fan-out**: `split` with `fanout: true`, no join; count each branch's deliveries at its own end.

**Kinds of work.** `classes` on the start, `when: "class:<name>"` on the routes. Each kind gets its own color, and the reader can remove half of one kind ("Half the noise").

**A layer the reader can turn off.** `switch: true` on the station (a firewall, a check) or on the choice (a cache, with `bypass: true` on the route that skips it). Start from the configuration that works, and let the reader take it apart.

**A load the reader can size.** `dials` on the start with a few rates (`every`) and `{ paused: true }` for none; `first` for when it begins.

**Servers that follow the load.** `scale` on the station, and a dial for its limits; give a database or anything that does not scale its own fixed `servers`, so the reader sees where the wall moves.

**Nested steps.** Put detail in `inside`; a level reads best with 3 to 7 steps, and a reader who wants the detail opens it. Levels can nest as deep as the subject goes (the memory example has five).

## From other notations

| BPMN | Dissect |
|---|---|
| Task | `station` (with `servers` and `work`) |
| Collapsed subprocess | `station` with `inside` |
| Exclusive gateway (XOR) | `choice` |
| Parallel gateway (AND) fork / join | `split` / `join` |
| Start / end event | `start` / `end` |
| Timer intermediate event | `timer` |
| Boundary timer on a task | `patience` on the station, route `timeout` |
| Error end event | `end` with `outcome: "fail"` |
| Pool / lane | lanes |
| Data store | `store` |
| Sequence flow | route; message flow between pools: a route with `latency` |

A **flowchart**'s process boxes are stations and its diamonds are choices; give each decision real odds or real outcomes. A **swimlane diagram** is lanes. A **value stream map**'s process boxes are stations (cycle time is `work`), its inventory triangles are the queues that form by themselves, and its lead time ladder is what the readout and the time layer measure. A **sequence diagram** becomes lanes for the participants and stations for what each one does, with `latency` on the routes between them (the TCP/IP and OAuth examples).
