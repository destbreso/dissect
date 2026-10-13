# Craft

How to make a process figure that teaches something and stays true. The kit draws well by itself; what it cannot do for you is choose the lesson, the numbers and the floor plan.

## 1. Start from the lesson

Before any part, write one sentence the reader should leave with, and the click that proves it:

| Figure | Lesson | The click |
|---|---|---|
| CI/CD pipeline | A third of a change's time is waiting for the reviewer, not CI | "One more at a time" on Code review |
| Request path | The trip is almost all of a request; the cache carries the database | "miss twice as often" inside the API |
| TCP/IP | A lost segment is paid in time, and the timer path costs ten round trips | "A burst" on the sender |
| Pub/sub | A subscriber in trouble only grows its own backlog | "Outage" on Email |
| Serverless | Cold starts make the tail; the queue absorbs what the sync path refuses | "A burst" on checkout |
| Sessions vs JWT | A session store is a dependency of every request; a JWT check is not | "Outage" on Session lookup |
| OAuth | The person is almost all of a login | Open the three phases |
| Memory | The rare trip to DRAM is a large part of the average | Open the levels down to the cells |
| Incident response | Noise takes the on-call's time; real problems wait behind it | "Half the noise" on the alerts |
| AES | CBC chains its blocks, CTR does not, and that is the speed difference | Open the levels down to the S-box |
| LLM harness | Every tool call is another full turn through the model | "A burst" on the client |
| Neural network | The GPU waits for data | "Twice as many at once" on the data loader |
| ETL | One step, the join, is most of the time from source to dashboard | "Twice as fast" on the join |
| CUDA | A memory-bound kernel is as fast as the warps that can wait at once | "Half as many" on the resident warps |

If you cannot write the sentence, the figure will be a flowchart that moves. Lessons that work are almost always one of: where the time goes (waiting, not working), what happens near capacity (queues grow steeply before the limit and without bound past it), how failures cost time (retries, timeouts, rework), how layers or nesting explain a single number, or what a dependency costs when it breaks.

## 2. Truth first

Collect real numbers before you place parts. Ask for them; when you must choose them, choose plausible ones and say so (in the model's header comment and in the prose: "a team of about eight engineers", "a user on the same continent").

- **Arrivals at random**: `exp mean`. Bursts are a what-if, not the base.
- **Service times**: `logn median p95`. People know their median and their bad day; a log-normal with those two is close to real service time distributions and has their long right tail.
- **Machine steps**: `const` or a narrow `uni`.
- **Capacities**: count the real servers: reviewers on duty (not the team), connections in the pool, consumers on a subscription, reserved concurrency, load ports. A step that is pipelined (a cache, a router's forwarding) has capacity for its issue rate, not its latency: model the port (`servers: 2, work: 0.25`) and the latency (`servers: "inf"`) as two steps.
- **Failure rates and odds**: as measured or reported; give them the words the team uses (`failLabel`).

## 3. Calibrate

The simulator is the only judge. Run the model on several seeds (the audit runs eight; a quick script with `metricsOf(def, seed)` from `kit/audit.mjs` runs as many as you like) and look at:

- **Utilization of the bottleneck** over the period. Between about 0.6 and 0.9 a queue forms, is visible, and drains. Below 0.5 nothing waits and the figure is calm and dull. Above 0.95 the queue grows until the horizon; that is a figure about overload, and the prose must say so.
- **Every route taken.** A route no item takes in eight runs is a promise the figure never keeps. Raise its chance, mark it `seldom` if a what-if is what exercises it, or drop it.
- **The lesson's number.** Measure it on the base run and on the what-if. If the what-if does not produce the effect, change the numbers (not the caption). In the request-path example the cold cache first changed nothing: the database had too much room. Heavier queries made the cascade real, and the caption reports it as measured.
- **The seed.** Pick one whose run is close to the median of the seeds on the lesson's number. A lucky day is a lie of omission.

Watch for one trap: stats taken before the run has drained, or at a time the run has already passed, are wrong. `stats()` describes the run up to the moment it has reached; use `createSim(def).runUntil(horizon).stats()` for busy shares over the period, and `simulate(def).stats()` for times over every item.

## 4. Plan the floor

- **Lanes are actors.** Who or what does the work: a person, a team, a service, a layer of a stack. A lane with nothing in it is noise; a lane per subscriber or per layer is often the clearest drawing of all.
- **Columns are time.** Left to right. Each column is as wide as its widest part plus room for a station's queue on its input side.
- **3 to 7 steps a level, at most 6 columns (about 1100 px).** Wider and it gets small on a laptop; the audit warns. Group steps into a station's `inside` and let the reader open it.
- **Rework and returns:** put the step that receives the rework in the lane of whoever does it, above or below the step that rejects, so the loop is a small rectangle and not a long trip around the figure. A step whose work comes from the right and leaves to the left is drawn flipped, with its queue on its right.
- **Ends near their source.** An end at the far right drags its route across everything; place it next to the step that sends items there.
- **Branches above and below.** A choice's branches leave from the vertex facing their target. Put the likely path straight ahead and the exceptions above or below.
- **Serpentines for long sequences.** Six sequential steps fit in three columns: across the top row, down, and back along the second row (the SRAM array).

## 5. Words

- **Names** are what the team says, about 14 characters at most: "Code review", "Redis GET", "On-call looks". A cut name is a warning.
- **`about`** says what happens there and what its numbers are, in one or two sentences, in plain words; it is what the inspector shows and what a screen reader hears.
- **Tags** only where a route decides: "red", "approved", "miss", "15 min, no answer". A plain hand-off needs none (`label: ""`).
- **The caption** says the lesson with the run's numbers, then names the click. It is generated (`figure.caption`) and its claims are in `claims`. Never write a number into it by hand, and never write a sentence whose truth depends on the run without checking the run: a caption that says "the queue explodes" when the what-if barely moves it is the worst thing a figure can do.
- No jargon you would not say aloud, and no slogans.

## 6. Time

A figure plays at a `pace` (model time per second). By default a typical item crosses the top level in about 12 seconds at 1×, which suits most processes. Set `figure.pace` when the lesson needs a different scale: a retransmission timer that is ten round trips long should look ten round trips long. Opening a step slows the clock to that step's own scale (the readout shows "time ×1/40"), so a figure can hold nanoseconds and picoseconds, or seconds of a person and milliseconds of a protocol, without anything being invisible or interminable.

## 7. What makes a process figure lie

- **Motion without a model.** Dots that glide at a steady pace through every box. The kit only moves what the simulator moved; do not add animation around it.
- **A healthy bottleneck that the prose calls a crisis**, or a crisis the prose calls healthy. Check utilization and say what it is.
- **Averages that hide the tail.** Report a median and a p95 (or p99 when the tail is the story).
- **A cherry-picked seed.** Use the median day.
- **Hidden capacity.** Infinite servers where there is a real limit (a pool, a rota) erases the queue the figure exists to show.
- **Rare paths shown as common**, or the reverse: odds must be real.
- **Decoration.** A box that does nothing, a lane with nothing in it, a glyph that means nothing: each makes the reader look for a meaning that is not there.
