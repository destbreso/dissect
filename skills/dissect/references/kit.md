# The kit

Plain ES modules, no dependencies, Node 20.10+ or any modern browser. The browser runtime is `rng`, `dist`, `geom`, `model`, `sim`, `replay` and `live`; `layout`, `render`, `page` and `audit` run at build time (and `page` reads the kit's own files, so it is Node only).

## kit/model.mjs

- `normalize(def, path?)`: fills defaults and builds the indexes (`byId`, `outs`, `ins`) for a level and, recursively, every `inside`. Pure.
- `validate(def, { throws? })` → `{ errors, warnings, model }`: every structural check, in sentences that name the part or route.
- `KINDS`, `OUTCOMES`.

## kit/dist.mjs

- `sampler(spec)` → `(rng) => duration`; `checkDuration(spec)` → error or `null`; `meanOf(spec)`.
- `describe(spec, unit)`: in words ("median 12 min, p95 30 min"); `short(spec, unit)`: for plates ("12 min, p95 30"; picoseconds below a nanosecond).
- `formatDuration(v, unit)`: a time for people ("2 h 15 min", "1.3 min", "50 ps").
- `scaleSpec(spec, k)`: the same distribution stretched by `k` (what-ifs use it).

## kit/sim.mjs

- `createSim(def, { seed, horizon, changes, warmup })` → a simulator: `runUntil(t)`, `runToEnd(limit?)`, `stats()`, `log`, `now`.
- `simulate(def, opts)`: create and run (`until` or to the end).
- `changes`: `[{ t, part: "<path>", set: { servers, work, fail, patience, wait, capacity, every, p, classes } }, { t, route: "<level>::<id>", set: { latency } }]`. A change applies from its moment on; the run before it is identical to the run without it, because every part draws from its own random stream.
- `stats()` → `{ t, born, done, inSystem, outcomes, throughput, wip, meanLead, p50Lead, p95Lead, p99Lead, steady, stations: { <path>: { arrivals, started, finished, failed, timedOut, rejected, busy, utilization, meanQueue, maxQueue, meanWait, p95Wait, meanWork } }, routes, choices }`. It describes the run up to the time it has reached.
- The log, one record per event: `{ t, k, tok, at, ... }` with `k` one of `born move queue start finish renege reject decide split joinwait join wait enter exit done change`. `at` is a part path (`"ci/unit"`), `route` is `"<level path>::<route id>"`. The page and the audit read only the log.

## kit/layout.mjs

- `layout(model, options?)` → `{ width, height, lanes, parts, routes, uses, columns, texts, options }` for one level. Options override `DEFAULTS` (`row`, `pad`, `laneHead`, `lanePad`, `gutter`, `queueRoom`, `after`, `emptyCol`, `loopGap`, `loopStep`, `radius`, `stub`). Sizes are in `SIZES`.
- The router tries every pair of sides (and, for a station's top and bottom, three attachment points) with many orthogonal paths, and keeps the cheapest: length, bends, a part crossed (never), words crossed, another route run over (free when the two share a port), a lane boundary followed, a station's queue run too short, sides that read backwards.

## kit/render.mjs

- `sheetSvg(layout, model, { uid, label })` → `{ svg, meta }`: one level's drawing, and the geometry the page needs (route polylines, queue slots, bays, needles, mini-maps).
- `cardHtml({ id, fig, title, sheets, hint, caption, legend, theme })`, `pageHtml({ title, body, script, theme, lang, head })`, `css()`.
- `THEMES` (`light`, `dark`; `theme: "auto"` follows the reader), `GLYPHS` and `glyphOf(part)`: service, human, team, robot, build, test, deploy, review, code, merge, db, cache, network, server, balance, mail, lock, key, gate, queue, cloud, phone, browser, doc, check, bell, search, wrench, money, truck.

## kit/replay.mjs

- `new Replay(log, { stations, ends })`: `advance(t)`, `next`, `drain()` (the events since the last call), `utilization(path, t)`, `quantile(q)`, and the state: `tokens`, `alive`, `st` (per station: queue, bays, counters, waits), `timers`, `choices`, `ends`.
- `placeOf(replay, token, metas, view, t)`: where an item is drawn on a level's sheet at time t (on a route, in a queue slot, docked in a bay, on a timer's rim, small in a station's window).

## kit/live.mjs (browser)

- `mount(root, def, { metas, pace, speed, autoplay, idle, outage, burst, levelPace, hint })` → the figure's handle; also on `root.dissect`.
- `boot()`: mounts every figure on the page from its embedded `<script type="application/json" data-dissect="<id>">`.
- The handle: `play()`, `pause()`, `step()`, `setSpeed(k)`, `setLayer("flow" | "time" | "fail")`, `open(path)`, `up()`, `select(path)`, `follow(id)`, `inject(changes, words?)`, `undo()`, `restart(nextSeed?)`, `seek(t)`, `state()`, `replay`.
- Events, bubbling from the `<figure>`: `dissect:select` and `dissect:open` (`{ path, part }`), `dissect:follow` (`{ id }`). `part` carries any field you put on it in the model.

## kit/page.mjs (Node)

- `buildFigure(def, { id, fig, title, caption, hint, theme, pace, speed, autoplay, idle, outage, layout, legend })` → `{ html, data, warnings, levels, model }`: every level laid out and drawn (the top one visible), the legend, and the data script.
- `standalonePage(def, opts)` and `writePage(def, path, opts)`: a whole page; `opts.figures: [{ def, opts }]` puts several figures on it, with `intro` and `outro` HTML around them.
- `embed(def, opts)` → `{ html, styles, script }`: for a page you already have. Put `styles` once, each figure's `html` where it goes, and `script` once after the last.
- `runtimeScript()`: the runtime as one classic script (the inliner wraps each module in its own scope; the kit keeps to single-line `import { a } from "./x.mjs"` and `export function|const|class` so it can).

## kit/audit.mjs

- `audit(def, { seeds?, layout? })` → `{ errors, warnings, notes, metrics }`; `report(result)`; `auditOrExit(def, { strict? })`.
- `auditLayout(level, layout)`, `auditRun(model, def)`, `metricsOf(def, seed)` (the claim metrics; use it to calibrate).

## scripts

- `scripts/build.mjs <model.mjs | model.json> [--out f] [--light | --dark] [--audit] [--strict] [--embed]`. A model module exports the model as default and may export `figure` (`fig`, `title`, `hint`, `pace`, `outage`, `caption`). `load(file)` and `captionContext(def)` are exported for build scripts of your own (the auth-flows example builds two figures on one page with them).
- `scripts/check.mjs page.html`: the visual check in headless Chrome (`build.mjs --check` runs it); `scripts/capture.mjs`, `scripts/drive.mjs`: see `verify.md`.

## Linking a figure to something else

A figure tells the page what the reader does (`dissect:select`, `dissect:open`, `dissect:follow`, bubbling from its `<figure>`) and takes orders through its handle, so a few lines on the page tie it to anything: a paragraph that highlights when its step is selected, a second figure that follows the first, a chart of the same run.

```js
const fig = document.getElementById("dx-ci-pipeline");
fig.addEventListener("dissect:select", (e) => {
  for (const el of document.querySelectorAll("[data-step]")) el.classList.toggle("lit", el.dataset.step === e.detail.part?.section);
});
for (const el of document.querySelectorAll("[data-step]")) el.addEventListener("click", () => fig.dissect.select(el.dataset.path));
```

Put the extra field (`section` here) on the parts in the model; it travels with the part in every event. To link across frames or origins, post messages instead of reaching into the other page.

## A page of your own

```js
import { embed } from "./dissect/kit/page.mjs";
import model from "./model.mjs";
const { html, styles, script } = embed(model, { fig: "Fig 3", caption: "..." });
// styles in <head>, html where the figure goes, script before </body>
```

## React and Next.js

Render the figure at build time, mount it on the client. The figure's HTML carries its model and geometry as inert JSON, so the client component only has to call `boot()` once it is in the DOM.

```tsx
// app/figures/pipeline.tsx (a server component)
import { buildFigure } from "@/dissect/kit/page.mjs";
import { css } from "@/dissect/kit/render.mjs";
import model from "./pipeline.model.mjs";
import { Dissect } from "./dissect-client";

export default function Pipeline() {
  const { html } = buildFigure(model, { fig: "Fig 1", theme: "auto" });
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css() }} />
      <Dissect html={html} />
    </>
  );
}
```

```tsx
// app/figures/dissect-client.tsx
"use client";
import { useEffect, useRef } from "react";
import { boot } from "@/dissect/kit/live.mjs";

export function Dissect({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => boot(), []);
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
```

`boot()` skips figures that are already mounted, so calling it again after a client navigation is safe. Put the kit's `.mjs` files in your source tree (they have no dependencies) and import them as ES modules.
