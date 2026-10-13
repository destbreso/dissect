---
name: dissect
description: Build interactive figures that explain a process by running it, such as a CI/CD pipeline, a request through an architecture, a network handshake, an incident response, or an approval or support workflow. The figure is a living machine on a floor plan (stations with bays and queue rails, decision gates, parallel splits, timers, swimlanes) driven by a seeded discrete-event simulation, so every queue, counter and caption number is measured, never drawn. Any step can be opened into its own process, any item followed, and the reader can try what-ifs (an outage, one more reviewer, a colder cache, a firewall turned off). Use it whenever someone wants to visualize, explain or animate a workflow, pipeline, process flow, BPMN or swimlane diagram, value stream, queue, bottleneck, system or network flow, protocol exchange or human process, even if they never say "simulation". Framework-free (a Node build writes one standalone HTML page or an embeddable fragment), and it mounts in React or Next.js.
license: MIT
compatibility: Written for Claude Code; also runs in Codex, OpenCode and Antigravity. Needs Node.js 20.10+ (built-in modules only) and Chrome or Chromium for the browser checks.
metadata:
  version: "0.2.0"
  author: "David Estévez"
  repository: "https://github.com/destbreso/dissect"
---

# Dissect

This skill makes figures of processes the way an engineer builds a test bench for one: a floor plan of stations, rails and gates on a dotted sheet, with work items that arrive, queue, get worked on, fail, loop back, split into parallel branches and leave. Nothing moves by animation. A seeded discrete-event simulation runs the model and the page replays its log, so a queue on screen is a queue in the model, and every number in the readout, the inspector and the caption comes from that same run. A step that hides a process of its own has a window: open it, and the machine inside runs with the same items. The reader can follow one item through the whole thing, switch to the layer that shows where the time goes or where work fails, and try what-ifs: take a step down for an hour, give it one more person, make the cache miss twice as often. Where the model gives them, switches on the parts turn them off and on, and a part's settings (the size of the load, how far autoscaling may go) open on the figure, next to it, when the reader clicks it; either applies from the moment the reader moves it. Everything before the moment of the change stays exactly as it was.

Complete examples ship with the skill. Open the closest one before you start. Each is built with `node examples/<name>/build.mjs` (add `--light`, `--dark` or `--audit`), which writes a standalone page next to it.

- `examples/ci-pipeline/` is the quality bar: from commit to production. CI (unit tests, lint and build in parallel) and Ship (merge, canary, a watch period, then roll out or roll back) open into their own processes; red builds and requested changes go back to the author. Its lesson, generated from the run: about a third of a change's time is spent waiting for the one reviewer on duty, and a second reviewer cuts that wait from about 15 minutes to about one.
- `examples/request-path/` is one request from the browser to the database, in milliseconds. Network latency makes the items travel; the edge cache, Redis and Postgres decide where they go. The trip is almost all of the time, and the cache carries the database: make Redis miss more often and the workers fill, the queue grows and the 504s start.
- `examples/tcp-ip/` is one segment through TCP/IP: down the sender's stack (its layers are lanes), through a home router whose small buffer overflows, across the internet and up the receiver's stack. A dropped segment is resent after three duplicate ACKs, or after the retransmission timer when it was the last of its burst.
- `examples/pubsub/` is one event and three subscribers: a fan-out to email, inventory and analytics, each with its own queue, consumers, retries and a dead-letter queue. Take one subscriber down and the others do not notice.
- `examples/serverless/` is a checkout on serverless: API Gateway, a function with a concurrency limit and cold starts, and a queue to a second function. Cold starts make the slow tail; a burst is refused by the synchronous path and absorbed by the queue.
- `examples/auth-flows/` is two figures on one page: the check on every request (a session looked up in a store against a JWT checked by its signature, with the store's outage as the what-if), and an OAuth authorization code login with PKCE in three phases you can open, where the person is almost all of the time.
- `examples/memory/` is a load from the core down to the bits: L1, L2, L3 and DRAM, five levels deep, down to an SRAM array (a bit as two cross-coupled inverters, read by sense amplifiers into a flip-flop) and DRAM row activation (a bit as a capacitor). The clock slows as you open deeper levels.
- `examples/incident-response/` is a human process: alerts, one on-call engineer, escalation after 15 minutes, the owning team or a war room. Four alerts in five are noise, and real problems wait behind them.
- `examples/aes/` is AES from the mode of operation down to the S-box: CBC and CTR with GCM encrypting the same message side by side, AES-128's ten rounds, a round's four steps, and SubBytes as an inverse in GF(2^8) and an affine map. CTR finishes several times sooner because its blocks do not wait for each other. AES is a substitution-permutation network, not a Feistel cipher, and the figure says so.
- `examples/llm-harness/` is a message to an LLM and the harness around it. The model stays a closed box (its batch slots); the gateway, the context (history, retrieval and attachments, side by side), the tool loop and the output check are the figure. Every tool call is another full turn through the model.
- `examples/neural-network/` is training a neural network, from the perceptron up: a data loader feeding a GPU, a training step whose forward pass runs left to right and whose backward pass runs back right to left, and a dense layer that is 128 perceptrons (weighted sum, bias, activation). The GPU waits for data; double the loader's workers and it stops.
- `examples/etl/` is a day of ETL: three sources at their own rhythm, extract, land raw, transform (schema, clean, join with the dimensions, aggregate), load and quality checks. One step, the join, is most of the time from source to dashboard.
- `examples/cuda/` is a CUDA kernel warp by warp: 640 warps, 320 resident, each alternating a global-memory wait with a little compute. Latency hiding made visible: halve the resident warps and the kernel takes twice as long.
- `examples/ddos/` answers a question: how does a site survive a DDoS attack? An edge network (WAF rules, a rate limit, a browser challenge, the cache) in front of an origin (a load balancer, app servers that scale, a database that does not), under a botnet's flood. Every layer has a switch, and the attack, the crowd and the autoscaling have dials; pages, assets and bots each have their odds at every layer, and the readout says how many pages are served. With every layer on the edge stops 99% of the attack; turn the challenge off and the origin loses a minute while new servers boot.

## The one idea that matters

**The process is a machine you can open.** Don't draw boxes and arrows. Build the process as a working machine whose every part stands for a quantity of the model, run it, and let the reader look inside.

| In the process | On the floor plan |
|---|---|
| A step with limited capacity (a reviewer, a pool of runners, a database) | A station: one bay per server, a queue that forms on the rail into it, a utilization gauge, a status lamp, counters |
| Work that waits | Items on the queue rail, one tick per place, "+n" past six |
| An exclusive decision (passed? approved? cached?) | A choice: a diamond whose needle points at the way the last item took |
| Work done in parallel | A split and a join; the item waits at the join for its slowest branch |
| Waiting by design (a bake time, a backoff, an approval window) | A timer: a clock face whose rim carries the waiting items |
| A step with a process of its own | A station with a window that shows its inside; open it |
| Who or what does the work | Lanes |
| Time on the wire, a hand-off | Latency on a route: the item visibly travels |
| A database or a file a step reads | A store, linked to the steps that use it |
| Kinds of work treated differently (people and bots, pages and assets) | Each kind in its own color, with its own odds at every decision and its own failure rate at every step |
| A part the reader can turn off (a firewall, a cache, a check) | A switch on its plate; off, the part lets everything straight through |
| A setting the reader can choose (the size of an attack, a policy's limit) | A dial in the part's settings panel, which opens on the figure next to the part (a badge on it says it has one); its options change the model from the moment one is chosen |
| Servers that follow the load (autoscaling) | A bay for every server the step can have: running, starting, not there |
| A load generator's virtual users (k6) | A closed start: users in stages, each pausing between its items, so a slower answer means fewer items a second |
| A sample, an event or a log a step sends as it works | An emitting route, dashed, with a new item of its own kind |

Two ways this fails, both common:

- **Too abstract.** A flowchart with no numbers shows the shape and never the behavior: where work waits, what breaks under load.
- **Too fake.** Motion that does not come from a model, like dots gliding at a steady pace through every box, teaches nothing, and the first reader who knows the system stops trusting the figure.

The fix for both is the same: a real model with real numbers, run.

## Workflow

Work in this order. Write the model and check its numbers before you look at the drawing; most of the quality is decided there.

1. **Size it** before any other work, and tell the user roughly how long it will take when the tier calls for it.
   - **Figure**: one level, 4 to 8 parts, one lesson. Build it without asking; it usually takes well under an hour.
   - **Hero**: two or three levels (a top level and the steps that open), 15 to 35 parts, a story with a what-if. About 1 to 3 hours. Say so, then build it.
   - **Epic**: a whole platform or organization (many teams, several connected processes). Do not start it. Propose a Hero that keeps the core of the story, list what the full version would add, and build the Epic only when the user chooses it.
   Have a page that opens in the browser early, and deepen it from there.
2. **Truth first.** Collect the real numbers: how often work arrives, how long each step takes (as a median and a p95, which is how people know their own service times), how many can work at once, how often each step fails or sends work back, the latencies. Use the user's numbers when they have them; otherwise choose plausible ones, say so in the model's comments, and name the assumption in the prose ("a team of about eight engineers"). `references/model.md` has the notation.
3. **Find the lesson.** A process figure earns its place by showing what the reader did not see: where the time really goes (usually waiting, not working), what happens under load (a queue grows without limit when a step is busier than it can be, and steeply well before that), what a change does (one more person at the bottleneck; a colder cache). Decide which what-if proves it. That decides which numbers matter and which step the caption points at. When the question is what each part contributes (how does a site survive an attack? what does the cache buy us?), give those parts switches and the load a dial, start with the working configuration, and let the reader take it apart; `figure.watch` puts the one number that tells whether it still works in the readout.
4. **Plan the floor.** Lanes are the actors, top to bottom; columns run left to right in time. Keep a level to 3 to 7 steps and at most 6 columns (about 1100 px); push detail into a station's `inside`. Put rework where it happens, for example a "Fix it" step in the author's lane above the step that rejects. `references/craft.md` has the patterns.
5. **Write the model** as a module (`model.mjs`) that exports it. Give every step a reader will click an `about`, put every statement the prose makes about the numbers in `claims`, and export a `figure.caption` function that writes the caption from the run.
6. **Calibrate.** Run several seeds (the audit does). Keep a visible queue at the step that matters (busy about 60% to 90% of the period: below that nothing waits, above it the queue never settles), make sure every route is taken (mark what-if paths `seldom`), and pick a seed whose run is close to the median of the seeds, not a lucky day.
7. **Build, audit and check.** `node build.mjs --audit --check` must end with `audit passed` and `check passed`. The audit checks the model, the floor plan and the run on several seeds. The check measures the page in a real browser on every level, light and dark, in a wide font, desktop and phone: words inside their plates and clear of rails, parts and tags, WCAG contrast on everything, no sideways page scroll, and the figure plays, follows an item and takes a what-if. It writes a picture of every level to `shots/`. Errors stop the build; read every warning and either fix it or know why it stays.
8. **Verify like a critic.** Capture the page on desktop and at 390 px wide, in light and dark, and with reduced motion. Drive it: open every window, follow an item to its end, run the what-if the caption promises and check the queue does what the caption says. Read every PNG you make. The checklist is in `references/verify.md`.

## Setup

The kit is plain JavaScript modules with no dependencies:

| File | Use it for |
|---|---|
| `kit/model.mjs` | `normalize(def)` and `validate(def)`: the notation, its defaults and every structural check, with messages that name the part at fault |
| `kit/dist.mjs` | Durations (`"logn 12 30"`, `"exp 20"`, `"uni 2 5"`): `sampler`, `meanOf`, `describe`, `short`, `formatDuration`, `scaleSpec` |
| `kit/sim.mjs` | The simulator: `createSim(def, { seed, changes })` with `runUntil(t)`, `runToEnd()` and `stats()`, and `simulate(def, opts)`. Deterministic, one random stream per part |
| `kit/layout.mjs` | The floor plan: columns sized to their parts, a router that picks every orthogonal route by cost, words and tags placed off the routes |
| `kit/metrics.mjs` | `wideWidth(text, size, bold)`: the room the floor plan gives words, from the widths of two wide fonts, so they fit in any font a reader has |
| `kit/render.mjs` | The drawing as SVG strings, the card around it, the light and dark themes |
| `kit/replay.mjs` | The state of every part at any moment, read from the simulator's log; the page and the checks share it |
| `kit/live.mjs` | The browser runtime: playback, levels, following, layers, what-ifs, keyboard, screen readers, reduced motion |
| `kit/page.mjs` | `buildFigure`, `writePage` and `embed`: a standalone page or a fragment, with the runtime inlined |
| `kit/audit.mjs` | `audit(def)` and `auditOrExit(def)`: the drawing, the run and the claims |
| `scripts/build.mjs` | Build any model file: `node scripts/build.mjs model.mjs [--audit] [--light] [--embed]` |
| `scripts/check.mjs` | The visual check: the drawing measured in headless Chrome on every level, both themes, a wide font, desktop and phone, with a picture of each (also `build.mjs --check`) |
| `scripts/capture.mjs` | Headless Chrome screenshots, close-ups, console errors, sideways scroll |
| `scripts/drive.mjs` | Headless Chrome sequences: click parts and dots, press keys, call the figure's handle, wait for conditions, assert |

Pick the path that fits the project:

- **A standalone page, docs or a blog post, on any stack.** Write `model.mjs` and build it with `scripts/build.mjs`, or with a two-line `build.mjs` next to it as in the examples. For a page you already have, `--embed` writes a fragment (styles, figure and script) to paste in.
- **React or Next.js.** Render the figure's HTML at build time with `buildFigure` (in a server component or a script), put it in the page, and mount it once on the client with `mount(root, def, { metas })` from `kit/live.mjs`. `references/kit.md` has the component.

## The model on one screen

```js
export default {
  id: "review-loop", title: "A change through review", item: "change", unit: "min", seed: 1, horizon: 480,
  lanes: [{ id: "dev", label: "Author" }, { id: "review", label: "Review" }],
  parts: [
    { id: "push", kind: "start", lane: "dev", at: [0, 0], every: "exp 20" },
    { id: "review", kind: "station", lane: "review", at: [1, 0], label: "Code review", servers: 1, work: "logn 12 30", fail: 0.15, failLabel: "changes requested" },
    { id: "fix", kind: "station", lane: "dev", at: [1, 0], label: "Fix it", servers: "inf", work: "logn 15 45" },
    { id: "merged", kind: "end", lane: "review", at: [2, 0] },
  ],
  routes: [
    { from: "push", to: "review" },
    { from: "review", to: "merged", when: "ok", label: "approved" },
    { from: "review", to: "fix", when: "fail", label: "changes" },
    { from: "fix", to: "review" },
  ],
  claims: [{ metric: "review.waitShare", min: 0.2, say: "much of a change's time is waiting for review" }],
};
```

The kinds are `start` (every, or closed: vus stages and think), `end`, `station` (servers, work, fail, patience, capacity, inside, uses, scale), `choice` (its routes take `p`, or `when`: ok, fail, timeout, rejected, class:<name> or else, with `max` to cap a loop), `split`, `join`, `timer` (wait) and `store`. A chance or a work time can differ by kind of item (`fail: { bots: 0.6, people: 0.002 }`), and a route can `emit` a new item of another kind as each one leaves. A station or a choice can have a `switch`, and any part `dials`. Every part sits at `at: [column, row]` in its lane. `references/model.md` has every field, recipes (retry with backoff, rework, timeout, overflow, escalation, fan-out) and how BPMN, flowcharts, swimlanes and value stream maps translate.

## Craft rules (short form)

`references/craft.md` gives the reasoning and the recipes.

- **Every number comes from the run.** Never type a measured number into a caption, a label or the prose around the figure: generate it from the model (`figure.caption`), and state each claim in `claims` so the audit checks it on several seeds.
- **Service times as a median and a p95.** `logn median p95` says what people know about their own work; `exp mean` is right for work that arrives at random.
- **The bottleneck is the story.** Keep it where a queue forms and settles (busy 60% to 90% over the period). Above 95% the queue grows all day; show that only on purpose, and say it.
- **A level holds 3 to 7 steps.** More goes inside a step: a reader who wants detail opens it, and a reader who doesn't is not buried.
- **Each part stands for something real.** No box for decoration, no step that does nothing. A decision is a choice only where the process really decides; a station can sort its own outcomes (`when` on its routes).
- **Name things the way the team does,** and short (about 14 characters): "Code review", not "Peer code review process". The `about` text carries the rest.
- **Label a route only where it decides something** ("red", "approved", "miss"); a plain hand-off needs no tag.
- **Rework goes back where it really goes:** to its author, and through the same queue again.
- **One accent.** The followed item and the needles are orange; red means failed work and nothing else.
- **The what-if the caption talks about is one click away,** on the step the caption names.
- **Mark seldom paths.** A timeout route that only a what-if exercises gets `seldom: true`, so the audit knows it is not dead.
- **Switches and dials are for parts that really can be switched or set.** A firewall rule, a cache, a feature flag, an autoscaling limit, the size of an attack: yes. A step of the process that cannot be skipped: no. A dial's option labels are short (`2k/s`, `up to 8`), and the option the figure starts with is the model as written.
- **The controls are part of the figure.** Every figure has the same instrument: the level bar with its path back and Close when a step is open, the strip of keys (play, step, speed, layers, restart) with the readout, the inspector and its what-ifs, and the model's switches (on their plates) and settings panels (on the figure, next to their parts). A part's configuration belongs to the part: never collect it in a panel of its own, and never add buttons, overlays or legends of your own around the drawing. To tie a figure to something else on the page (another figure, a paragraph that highlights), listen to its events (`dissect:select`, `dissect:open`, `dissect:follow`) and drive it through its handle.

## References

Read these as you need them:

- `references/model.md`: the notation in full: every field and default, durations, routes, classes, nested processes, stores, claims and metrics, the `figure` export, validation messages, recipes, and the mapping from BPMN, flowcharts, swimlanes and value stream maps.
- `references/craft.md`: choosing the lesson, planning the floor, sizing and naming, calibrating, writing the caption, and the anti-patterns that make a process figure lie.
- `references/kit.md`: the API of every module, the page contract (the embedded JSON, `window.dissect`, the figure's handle), embedding, React and Next.js.
- `references/live.md`: what the page does and how to tune it: pace and speed, glides, levels, following, layers, what-ifs, the idle tour, keyboard, screen readers, reduced motion.
- `references/verify.md`: the capture and drive commands, the audit's checks, the review checklist, common faults and their fixes.
- `references/walkthrough.md`: how the CI pipeline figure was made, from the first wrong model to the calibrated one.
