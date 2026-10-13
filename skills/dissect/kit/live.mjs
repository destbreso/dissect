// The live figure. The simulator runs a few seconds ahead of the clock the
// reader sees; the replay turns its log into the state of every part; this
// module draws that state on the pre-rendered sheets and lets the reader open
// steps, follow one item, and try what-ifs (an outage, one more reviewer). A
// what-if re-runs the model with the change from the current moment on: the
// past stays exactly as it was, because every part draws from its own stream.
//
// Browser only. Build pages with page.mjs, which inlines this module.

import { createSim } from "./sim.mjs";
import { normalize, chanceOf, switchChanges, dialChanges, kindsOf } from "./model.mjs";
import { Replay, placeOf, levelOf } from "./replay.mjs";
import { formatDuration, short, describe, scaleSpec, compact, rateWords, meanOf } from "./dist.mjs";
import { along } from "./geom.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SVGNS = "http://www.w3.org/2000/svg";
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const GLIDE_PX_S = 520;
const IDLE_MS = 7000;
const pct = (v) => (v == null || !Number.isFinite(v) ? "-" : `${Math.round(v * 100)}%`);
// a share that may be small: 0.2% says more than 0%
const pctFine = (v) => (v == null || !Number.isFinite(v) ? "-" : v > 0 && v < 0.0995 ? `${(v * 100).toFixed(1).replace(/\.0$/, "")}%` : `${Math.round(v * 100)}%`);


/**
 * Bring a figure to life.
 *   root     the <figure class="dx"> built by page.mjs (cardHtml + sheets)
 *   def      the process model
 *   options  { metas, pace, speed, autoplay, idle, outage, hint, tour }
 * Returns a handle: play, pause, step, setSpeed, open, up, select, follow,
 * inject, undo, restart, setLayer, state.
 */
export function mount(root, def, options = {}) {
  const model = normalize(def);
  const metas = options.metas || {};
  const unit = model.unit;
  const fmt = (v) => formatDuration(v, unit);
  // the reader's own setting, or the page's (a site that keeps its own preference sets data-reduced-motion)
  const reduced = (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) || (typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduced-motion"));

  // ---- the model, indexed --------------------------------------------------
  const levels = new Map();
  const parts = new Map();
  (function walk(m) {
    levels.set(m.path, m);
    for (const p of m.parts) {
      parts.set(p.path, p);
      if (p.inside) walk(p.inside);
    }
  })(model);
  const stationServers = new Map([...parts].filter(([, p]) => p.kind === "station").map(([path, p]) => [path, p.servers]));
  const endPaths = [...parts].filter(([, p]) => p.kind === "end").map(([path]) => path);
  // every kind of item: the starts' and the dials', then the ones stations emit
  const classNames = kindsOf(model);
  const classIndex = (c) => Math.max(0, classNames.indexOf(c)) % 6;
  const noun = model.raw.item || "item";
  // one dot can stand for many real items (a hundred requests): counts the reader sees are real ones
  const perDot = model.per || 1;
  const count = (n) => (perDot === 1 ? String(n) : compact(n * perDot));
  const plural = model.raw.items || `${noun}s`;
  // the window the recent numbers are over (who got served lately, not since the start)
  const watch = options.watch || null;
  const recentSpan = watch?.window ?? model.horizon / 20;
  const watched = watch ? new Set(watch.kinds || (watch.class ? [watch.class] : classNames)) : null;
  const watchQ = watch?.quantile ?? 0.5;
  // when the figure watches some kinds (requests, not the samples they send), its counts and times are theirs
  const narrowed = watched && classNames.some((c) => !watched.has(c));
  let tallyAt = -1;
  let tally = null;
  function counts() {
    if (!narrowed) return { done: R.done, alive: R.alive.size, q: (p) => R.quantile(p) };
    if (tally && tallyAt === R.i) return tally;
    const leads = R.finished.filter((f) => watched.has(f.cls)).map((f) => f.lead).sort((a, b) => a - b);
    let alive = 0;
    for (const id of R.alive) if (watched.has(R.tokens.get(id)?.cls)) alive += 1;
    tallyAt = R.i;
    tally = { done: leads.length, alive, q: (p) => (leads.length ? leads[Math.min(leads.length - 1, Math.floor(leads.length * p))] : NaN) };
    return tally;
  }

  // ---- the DOM -----------------------------------------------------------------
  const $ = (sel, el = root) => el.querySelector(sel);
  const stage = $(".dx-stage");
  const inspector = $(".dx-inspector");
  const levelbar = $(".dx-levelbar");
  const path = $(".dx-path");
  const keys = $(".dx-keys");
  const readout = $("[data-readout]");
  const say = $("[data-say]");
  const hint = $(".dx-hint");
  inspector.setAttribute("aria-live", "off");
  const sheets = new Map([...stage.querySelectorAll("svg[data-level]")].map((svg) => [svg.getAttribute("data-level"), svg]));
  const els = new Map(); // level -> cached elements of that sheet
  for (const [lv, svg] of sheets) {
    const partEl = new Map([...svg.querySelectorAll(".dx-part")].map((g) => [g.getAttribute("data-path"), g]));
    const routeEl = new Map([...svg.querySelectorAll(".dx-route")].map((g) => [g.getAttribute("data-key"), g]));
    const useEl = [...svg.querySelectorAll(".dx-use")];
    const qmore = new Map([...svg.querySelectorAll(".dx-queue")].map((g) => [g.getAttribute("data-queue"), g.querySelector("[data-qmore]")]));
    const per = new Map();
    for (const [path, g] of partEl) {
      per.set(path, {
        g,
        bays: [...g.querySelectorAll("[data-bay]")],
        rack: g.querySelector("[data-rack]"),
        done: g.querySelector("[data-done]"),
        fails: g.querySelector("[data-fails]"),
        count: g.querySelector("[data-count]"),
        lamp: g.querySelector("[data-lamp]"),
        gauge: g.querySelector("[data-gauge]"),
        needle: g.querySelector("[data-needle]"),
        hand: g.querySelector("[data-hand]"),
        heatWait: g.querySelector('[data-heat="wait"]'),
        heatWork: g.querySelector('[data-heat="work"]'),
        altTime: g.querySelector('[data-alt="time"]'),
        altFail: g.querySelector('[data-alt="fail"]'),
        frames: [...g.querySelectorAll(".dx-bay")],
        rate: g.querySelector("[data-rate]"),
      });
    }
    els.set(lv, { svg, partEl, routeEl, useEl, qmore, per, tokens: svg.querySelector(".dx-tokens"), trails: svg.querySelector(".dx-trails"), dots: new Map() });
  }

  // ---- run state ------------------------------------------------------------------
  let seedShift = 0;
  let changes = [];
  let sim;
  let R;
  let clock = 0;
  let playing = options.autoplay !== false && !reduced;
  let speed = options.speed ?? 1;
  let pace = options.pace ?? null;
  let view = "";
  let selected = null;
  let followed = null;
  let followInside = true;
  let idleFollow = false;
  let layer = "flow";
  let lastInteraction = -Infinity;
  let visible = true;
  let playTime = 0;
  let endedAt = null;
  const glides = new Map();
  const fading = new Map();
  const pulses = [];
  const lastPulse = new Map();
  const trail = [];

  // ---- settings: the reader's switches and dials ---------------------------------------------
  // They hold from the moment they are set, and a new run starts with them as they are.
  const controls = [];
  for (const [path, p] of parts) {
    const lv = levels.get(levelOf(path));
    if (p.switch) controls.push({ key: `switch:${path}`, kind: "switch", path, part: p, level: lv, name: p.switch.label ?? p.label, initial: p.switch.on !== false });
    (p.dials || []).forEach((d, di) => controls.push({ key: `dial:${path}#${di}`, kind: "dial", path, part: p, level: lv, dial: d, initial: d.value ?? 0 }));
  }
  const controlOf = new Map(controls.map((c) => [c.key, c]));
  const settings = new Map(controls.map((c) => [c.key, c.initial]));
  /** The changes that start a run where the reader left the settings. */
  function settingChanges() {
    const out = [];
    for (const c of controls) {
      const v = settings.get(c.key);
      if (v === c.initial) continue;
      const list = c.kind === "switch" ? switchChanges(c.level, c.part, v) : dialChanges(c.level, c.part, c.dial, v);
      out.push(...list.map((x) => ({ ...x, t: 0 })));
    }
    return out;
  }
  const isOff = (path) => settings.get(`switch:${path}`) === false;

  function build() {
    sim = createSim(model, { seed: model.seed + seedShift, changes });
    R = new Replay(sim.log, { stations: stationServers, ends: endPaths });
  }
  build();

  // the pace: a typical item crosses the figure in about twelve seconds at 1x
  if (!pace) {
    const probe = createSim(model, { seed: model.seed });
    probe.runUntil(Math.min(model.horizon, model.horizon * 0.5 + 1));
    const s = probe.stats();
    const typical = s.done >= 3 ? s.p50Lead : model.horizon / 6;
    pace = Math.max(1e-6, typical / 12);
  }
  // time zooms with space: inside a step, the clock runs at that step's own scale
  const basePace = pace;
  const levelPace = new Map([["", basePace]]);
  {
    const probe = createSim(model, { seed: model.seed });
    probe.runUntil(model.horizon);
    const P = new Replay(probe.log, { stations: stationServers, ends: endPaths });
    P.advance(Infinity);
    for (const [path, p] of parts) {
      if (p.kind !== "station" || !p.inside) continue;
      const s = P.st.get(path);
      const typical = s?.workN ? s.workSum / s.workN : null;
      levelPace.set(path, options.levelPace?.[path] ?? (typical ? Math.min(basePace, typical / 8) : basePace));
    }
  }
  const paceOf = (lv) => levelPace.get(lv) ?? basePace;
  const lookahead = () => pace * Math.max(1, speed) * 4;

  // ---- what-ifs ---------------------------------------------------------------------
  /** Re-run with a change from now on. The run up to now is unchanged by construction. */
  function inject(list, words) {
    const t = clock + pace * 1e-4;
    const add = (Array.isArray(list) ? list : [list]).map((c) => ({ ...c, t: c.t ?? t }));
    changes = changes.concat(add).sort((a, b) => a.t - b.t);
    const keepI = R.i;
    const prev = R.log;
    sim = createSim(model, { seed: model.seed + seedShift, changes });
    sim.runUntil(clock + lookahead());
    const same = keepI === 0 || JSON.stringify(sim.log[keepI - 1]) === JSON.stringify(prev[keepI - 1]);
    if (same) R.log = sim.log;
    else {
      R = new Replay(sim.log, { stations: stationServers, ends: endPaths });
      R.advance(clock);
      R.drain();
    }
    // the change itself shows at once (a dial's new value, a policy), even while paused
    R.advance(t);
    glides.clear();
    if (words) announce(words);
    renderInspector();
    renderControls();
  }

  function undo() {
    if (!changes.length) return;
    changes = [];
    for (const c of controls) settings.set(c.key, c.initial);
    syncSwitches();
    build();
    sim.runUntil(clock + lookahead());
    R.advance(clock);
    R.drain();
    glides.clear();
    announce("What-ifs removed. This is the run as modelled.");
    renderInspector();
    renderControls();
  }

  function restart(nextSeed = false) {
    if (nextSeed) seedShift += 1;
    else seedShift = 0;
    // what-ifs end with the run; the settings carry over to the next
    changes = settingChanges();
    clock = 0;
    endedAt = null;
    build();
    for (const e of els.values()) {
      for (const d of e.dots.values()) d.remove();
      e.dots.clear();
      e.trails.textContent = "";
    }
    glides.clear();
    fading.clear();
    trail.length = 0;
    if (followed && !idleFollow) setFollow(null);
    renderInspector();
    renderControls();
  }

  /** Show every switch as it is set (the part dims, the knob moves, the words say so). */
  function syncSwitches() {
    for (const c of controls) {
      if (c.kind !== "switch") continue;
      const on = settings.get(c.key);
      for (const e of els.values()) {
        const g = e.partEl.get(c.path);
        if (!g) continue;
        g.toggleAttribute("data-off", !on);
        const sw = g.querySelector("[data-switch]");
        if (sw) {
          sw.setAttribute("aria-checked", String(on));
          sw.setAttribute("aria-label", `${c.name}: ${on ? "on" : "off"}`);
          const tip = sw.querySelector("title");
          if (tip) tip.textContent = `Turn ${c.name} ${on ? "off" : "on"}`;
        }
        const spec = g.querySelector(".dx-spec[data-fit]");
        if (spec) fitInto(spec, on ? spec.dataset.full : "switched off", Number(spec.dataset.fit), Number(spec.dataset.size), Number(spec.dataset.min), true);
      }
    }
  }

  /** Turn a part off or back on, from now on. */
  function toggle(path) {
    const c = controlOf.get(`switch:${path}`);
    if (!c) return;
    const on = !settings.get(c.key);
    settings.set(c.key, on);
    const way = c.part.kind === "choice" ? c.level.outs.get(c.part.id).find((r) => r.bypass) : null;
    const offWords = way ? `everything goes to ${c.level.byId.get(way.to).label}` : "everything passes straight through it";
    syncSwitches();
    inject(switchChanges(c.level, c.part, on), on ? `${c.name} is on again.` : `${c.name} is off: ${offWords}.`);
  }

  /** Set a dial to one of its options, from now on. */
  function chooseOption(key, index) {
    const c = controlOf.get(key);
    if (!c || settings.get(key) === index) return;
    settings.set(key, index);
    if (c.dial.restart) {
      // a setting that only makes sense from the start (a test plan): the run starts again with it
      restart(false);
      announce(`${c.part.label}: ${c.dial.label}, ${c.dial.options[index].label}. The run starts again.`);
      return;
    }
    inject(dialChanges(c.level, c.part, c.dial, index), `${c.part.label}: ${c.dial.label}, ${c.dial.options[index].label}.`);
  }

  // ---- levels -----------------------------------------------------------------------------
  let heightTimer = 0;
  function setView(path, { focus = false, from = null } = {}) {
    if (!sheets.has(path) || path === view) return;
    closePanel();
    const prev = view;
    const a = sheets.get(prev);
    const b = sheets.get(path);
    const down = path.startsWith(prev ? `${prev}/` : "");
    // zoom toward the opened station, or out of the closed one
    const anchorPath = down ? path : prev;
    const anchorLevel = down ? prev : path;
    const box = metas[anchorLevel]?.parts[anchorPath];
    const m = metas[anchorLevel];
    if (box && m && !reduced) {
      const origin = `${((box.x / m.width) * 100).toFixed(1)}% ${((box.y / m.height) * 100).toFixed(1)}%`;
      const parentSheet = down ? a : b;
      parentSheet.style.transformOrigin = origin;
      if (down) {
        b.style.transition = "none";
        b.style.transform = "scale(.86)";
        void b.getBoundingClientRect();
        b.style.transition = "";
        a.style.transform = "scale(1.9)";
      } else {
        b.style.transition = "none";
        b.style.transform = "scale(1.9)";
        void b.getBoundingClientRect();
        b.style.transition = "";
        a.style.transform = "scale(.86)";
      }
    }
    const h0 = stage.offsetHeight;
    stage.style.height = `${h0}px`;
    a.classList.add("dx-off");
    b.classList.remove("dx-off");
    requestAnimationFrame(() => {
      b.style.transform = "scale(1)";
      stage.style.height = `${b.getBoundingClientRect().height || h0}px`;
    });
    clearTimeout(heightTimer);
    heightTimer = setTimeout(() => (stage.style.height = ""), reduced ? 0 : 560);
    setTimeout(() => {
      // the sheet we left is hidden: put it back at rest without animating (a transform in flight widens the scroll area)
      if (view === prev) return;
      a.style.transition = "none";
      a.style.transform = "";
      void a.getBoundingClientRect();
      a.style.transition = "";
    }, 520);
    view = path;
    const before = pace;
    pace = paceOf(path);
    for (const g of a.querySelectorAll('.dx-part[data-open="1"]')) g.setAttribute("aria-expanded", "false");
    const holder = els.get(levelOf(path))?.partEl.get(path);
    if (holder) holder.setAttribute("aria-expanded", "true");
    renderCrumbs();
    emit("open", { path, part: path ? parts.get(path) : null });
    const lv = levels.get(path);
    const slower = before / pace;
    const timeNote = slower > 1.5 ? ` Time runs ${Math.round(slower)} times slower in here.` : slower < 0.67 ? " Time runs at its usual pace again." : "";
    if (path) announce(`Opened ${parts.get(path)?.label}: ${lv.parts.filter((p) => p.kind === "station").length} steps inside. Escape goes back.${timeNote}`);
    else announce(`Back to ${model.title || "the whole process"}.${timeNote}`);
    if (focus) {
      // going in: the first part inside; coming out: the step you came out of, on this level
      const came = from || prev;
      const rest = path ? came.slice(path.length + 1) : came;
      const holderHere = path ? `${path}/${rest.split("/")[0]}` : rest.split("/")[0];
      const target = down ? b.querySelector(".dx-part") : els.get(path)?.partEl.get(holderHere);
      target?.focus({ preventScroll: true });
    }
    selected = path || null;
    renderInspector();
    fit();
  }

  // the level bar: the way back up, and Close (only inside a step)
  let closeKey = null;
  function renderCrumbs() {
    levelbar.hidden = !view;
    path.textContent = "";
    if (!view) return;
    const chain = [""];
    const segs = view.split("/");
    for (let i = 1; i <= segs.length; i++) chain.push(segs.slice(0, i).join("/"));
    chain.forEach((p, i) => {
      if (i) {
        const sep = document.createElement("span");
        sep.className = "dx-pathsep";
        sep.textContent = "›";
        sep.setAttribute("aria-hidden", "true");
        path.append(sep);
      }
      const name = p ? parts.get(p)?.label : model.title || "Process";
      if (i === chain.length - 1) {
        const here = document.createElement("span");
        here.textContent = name;
        here.setAttribute("aria-current", "location");
        path.append(here);
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = name;
        b.title = `Back to ${name}`;
        b.addEventListener("click", () => setView(p, { focus: true, from: view }));
        path.append(b);
      }
    });
    if (!closeKey) {
      closeKey = document.createElement("button");
      closeKey.type = "button";
      closeKey.className = "dx-key dx-close";
      closeKey.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg><span>Close</span>`;
      closeKey.addEventListener("click", () => {
        touch();
        setView(levelOf(view), { focus: true, from: view });
      });
      levelbar.append(closeKey);
    }
    const holder = parts.get(view)?.label ?? "";
    closeKey.title = `Close ${holder} (Escape)`;
    closeKey.setAttribute("aria-label", `Close ${holder}`);
  }

  // ---- following one item -----------------------------------------------------------------
  function setFollow(id, { idle = false } = {}) {
    followed = id;
    if (!idle) emit("follow", { id });
    idleFollow = idle && id != null;
    trail.length = 0;
    for (const e of els.values()) e.trails.textContent = "";
    if (id && !idle) {
      announce(`Following ${noun} ${id}. Escape stops.`);
      selected = null;
      for (const e of els.values()) for (const g of e.partEl.values()) g.classList.remove("dx-sel");
    }
    renderInspector();
  }

  function pickIdle() {
    // the newest item on the shown level that still has most of its trip ahead
    let best = null;
    for (const id of R.alive) {
      const tok = R.tokens.get(id);
      if (R.levelOfToken(tok) !== view && !(view === "" && R.levelOfToken(tok) != null)) continue;
      if (!best || tok.born > best.born) best = tok;
    }
    if (best) setFollow(best.id, { idle: true });
  }

  // ---- the frame -------------------------------------------------------------------------------
  let last = typeof performance !== "undefined" ? performance.now() : 0;
  let raf = 0;
  let slowAt = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (playing) {
      clock += dt * pace * speed;
      playTime += dt;
    }
    sim.runUntil(clock + lookahead());
    R.advance(clock);
    events(R.drain());
    draw(now);
    if (now - slowAt > 250) {
      slowAt = now;
      drawSlow();
    }
    // the run is over: wait a moment, then a fresh day (the next seed)
    if (R.next === Infinity && R.alive.size === 0 && clock > model.horizon) {
      if (endedAt == null) endedAt = now;
      else if (now - endedAt > 2500 && playing) {
        announce("A new run starts.");
        restart(true);
      }
    }
    if (options.idle !== false && !followed && playing && now - lastInteraction > IDLE_MS && R.alive.size) pickIdle();
    if (visible && (playing || glides.size || fading.size || pulses.length)) raf = requestAnimationFrame(frame);
  }
  const wake = () => {
    if (!raf && visible) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  function events(list) {
    for (const e of list) {
      if (e.k === "move") {
        const rt = metas[e.route.slice(0, e.route.indexOf("::"))]?.routes[e.route];
        if (rt && !reduced && e.t1 - e.t < pace * 0.05) {
          const q = glides.get(e.tok) || [];
          const dur = Math.min(0.45, Math.max(0.14, rt.length / GLIDE_PX_S)) / Math.max(1, Math.sqrt(speed / 2));
          q.push({ route: e.route, dur, start: null });
          while (q.length > 2) q.shift();
          glides.set(e.tok, q);
        }
        // an instant hop lights its rail for a moment (a dot that travels needs no help), at most once a second
        if (!reduced && speed <= 4 && e.t1 - e.t < pace * 0.05 && (lastPulse.get(e.route) ?? -Infinity) < playTime - 1) {
          lastPulse.set(e.route, playTime);
          pulses.push({ key: e.route, until: playTime + 0.35 });
        }
        if (e.tok === followed) {
          trail.push(e.route);
          if (trail.length > 8) trail.shift();
        }
      } else if (e.k === "done") {
        fading.set(e.tok, playTime + 0.7);
        if (e.tok === followed) {
          if (idleFollow) setTimeout(() => followed === e.tok && setFollow(null), 900);
          else announce(`${noun[0].toUpperCase() + noun.slice(1)} ${e.tok} is done after ${fmt(e.lead)}.`);
        }
      } else if (e.k === "enter" && e.tok === followed && followInside && !idleFollow) {
        setView(e.station);
      } else if (e.k === "exit" && e.tok === followed && followInside && !idleFollow && view === e.station) {
        setView(levelOf(e.station));
      } else if (e.k === "start") {
        const p = parts.get(e.at);
        if (p?.uses) for (const u of els.get(levelOf(e.at))?.useEl || []) if (u.getAttribute("data-use") === e.at) flash(u, "dx-on", 500);
      } else if (e.k === "join" && followed && e.children?.includes(followed)) {
        setFollow(e.tok, { idle: idleFollow });
      } else if (e.k === "change") renderControls();
      else if (e.k === "scale") {
        const before = lastBooting.get(e.at) ?? 0;
        if (e.booting > before) announce(`${parts.get(e.at)?.label}: ${e.booting} more server${e.booting === 1 ? "" : "s"} starting.`);
        lastBooting.set(e.at, e.booting);
      }
    }
  }
  const lastBooting = new Map();

  function flash(el, cls, ms) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function glidePos(id, lv) {
    const q = glides.get(id);
    if (!q || !q.length) return null;
    while (q.length) {
      const g = q[0];
      if (g.start == null) g.start = playTime;
      const u = (playTime - g.start) / g.dur;
      if (u >= 1) {
        q.shift();
        if (q[0]) q[0].start = g.start + g.dur;
        continue;
      }
      const level = g.route.slice(0, g.route.indexOf("::"));
      if (level !== lv) return null;
      const rt = metas[lv].routes[g.route];
      const e = u * u * (3 - 2 * u);
      const [x, y] = along(rt.points, rt.length * e);
      return { x, y };
    }
    glides.delete(id);
    return null;
  }

  function draw() {
    const E = els.get(view);
    const meta = metas[view];
    if (!E || !meta) return;
    const seen = new Set();
    const place = (id) => {
      const tok = R.tokens.get(id);
      if (!tok) return;
      let p = placeOf(R, tok, metas, view, clock);
      if (!p) return;
      const g = !p.mini && glidePos(id, view);
      if (g) p = { x: g.x, y: g.y };
      let docked = false;
      if (p.dock && !g) {
        // in work: the item sits in its bay (or in the row of a step with no limit)
        const st = meta.stations[p.dock];
        const s = R.st.get(p.dock);
        if (st?.bays[p.bay]) p = { x: st.bays[p.bay].x0 + Math.min(4.2, st.bays[p.bay].w / 2), y: st.bays[p.bay].y, narrow: st.bays[p.bay].w + 2.8 };
        else if (st?.rack && s) {
          const k = s.bays.slice(0, tok.server).filter(Boolean).length;
          if (k >= st.rack.max) return;
          p = { x: st.rack.x + k * st.rack.step, y: st.rack.y };
        } else return;
        docked = true;
      }
      if (p.hidden) return;
      seen.add(id);
      let dot = E.dots.get(id);
      if (!dot) {
        dot = document.createElementNS(SVGNS, "g");
        dot.setAttribute("data-tok", id);
        dot.innerHTML = `<circle class="dx-tok-hit" r="9"/><circle class="dx-tok-halo" r="8.5" style="display:none"/><circle class="dx-tok" r="4.6"/>`;
        E.tokens.append(dot);
        E.dots.set(id, dot);
      }
      const [hit, halo, core] = dot.children;
      const r = p.mini ? 2.3 : docked ? Math.min(3.4, (p.narrow ?? 9) / 2 - 0.4) : 4.6;
      core.setAttribute("r", r);
      hit.setAttribute("r", p.mini ? 0 : 9);
      dot.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      const bad = tok.outcome && tok.outcome !== "ok";
      core.setAttribute("class", `dx-tok${bad ? " dx-c-bad" : ""}${id === followed ? " dx-lit" : ""}`);
      core.style.fill = `var(--dx-c${classIndex(tok.cls)})`;
      halo.style.display = id === followed && !p.mini ? "" : "none";
      const f = fading.get(id);
      dot.style.opacity = f != null ? Math.max(0, (f - playTime) / 0.7).toFixed(2) : "";
    };
    for (const id of R.alive) place(id);
    for (const [id, until] of fading) {
      if (playTime > until) fading.delete(id);
      else place(id);
    }
    for (const [id, dot] of E.dots) {
      if (!seen.has(id)) {
        dot.remove();
        E.dots.delete(id);
      }
    }
    // bays: how far along each item in service is
    for (const [path, per] of E.per) {
      if (!per.bays.length && !per.rack) continue;
      const s = R.st.get(path);
      const st = meta.stations[path];
      if (!s || !st) continue;
      per.bays.forEach((el, i) => {
        const b = s.bays[i];
        if (!b || b.t1 == null) {
          el.setAttribute("width", "0");
          return;
        }
        const u = Math.min(1, Math.max(0, (clock - b.t0) / Math.max(1e-9, b.t1 - b.t0)));
        el.setAttribute("width", (st.bays[i].w * u).toFixed(1));
        el.setAttribute("class", `dx-bay-fill${b.tok === followed ? " dx-lit" : ""}`);
      });
    }
    // timers: the hand follows the newest item waiting
    for (const [path, per] of E.per) {
      if (!per.hand) continue;
      const set = R.timers.get(path);
      if (!set || !set.size) continue;
      let newest = null;
      for (const id of set) {
        const t = R.tokens.get(id);
        if (!newest || t.t0 > newest.t0) newest = t;
      }
      const u = Math.min(1, (clock - newest.t0) / Math.max(1e-9, newest.t1 - newest.t0));
      per.hand.style.transform = `rotate(${(u * 360).toFixed(1)}deg)`;
    }
    // passing items light the rail for a moment
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const el = E.routeEl.get(p.key);
      if (playTime > p.until) {
        el?.classList.remove("dx-pass");
        pulses.splice(i, 1);
      } else el?.classList.add("dx-pass");
    }
    drawTrail(E);
  }

  function drawTrail(E) {
    if (!followed) {
      if (E.trails.firstChild) E.trails.textContent = "";
      return;
    }
    const pts = [];
    for (const key of trail) {
      const lv = key.slice(0, key.indexOf("::"));
      if (lv !== view) continue;
      const rt = metas[lv].routes[key];
      if (rt) pts.push(rt.points);
    }
    const d = pts.map((ps) => `M${ps.map((p) => p.join(" ")).join("L")}`).join("");
    let path = E.trails.firstChild;
    if (!path) {
      path = document.createElementNS(SVGNS, "path");
      path.setAttribute("class", "dx-trail");
      E.trails.append(path);
    }
    path.setAttribute("d", d);
  }

  // counters, lamps, gauges, needles, layers and the readout: a few times a second
  function drawSlow() {
    const E = els.get(view);
    if (!E) return;
    let maxTime = 0;
    for (const path of E.per.keys()) {
      const s = R.st.get(path);
      if (s && s.waitN) maxTime = Math.max(maxTime, s.waitSum / s.waitN + (s.workN ? s.workSum / s.workN : 0));
    }
    for (const [path, per] of E.per) {
      const p = parts.get(path);
      if (!p) continue;
      if (p.kind === "station") {
        const s = R.st.get(path);
        const okN = s.finished - s.failed;
        const bad = s.failed + s.timedOut + s.rejected;
        if (per.count && per.count.__n !== `${okN}/${bad}`) {
          per.count.__n = `${okN}/${bad}`;
          if (per.done) per.done.textContent = `✓${count(okN)}`;
          if (per.fails) per.fails.textContent = bad ? `✗${count(bad)}` : "";
          fitCount(per.count);
        }
        // a station that scales: which of its bays run, which are starting, which are not there
        if (p.scale && per.frames.length) {
          per.frames.forEach((f, i) => {
            f.classList.toggle("dx-bay-off", i >= s.servers + s.booting);
            f.classList.toggle("dx-bay-boot", i >= s.servers && i < s.servers + s.booting);
          });
        }
        const rackMax = metas[view].stations[path]?.rack?.max ?? 5;
        if (per.rack) per.rack.textContent = s.busy > rackMax ? `+${s.busy - rackMax}` : "";
        if (per.lamp) per.lamp.setAttribute("data-state", s.servers === 0 ? "down" : s.queue.length ? "queued" : s.busy ? "busy" : "idle");
        if (per.gauge) per.gauge.setAttribute("stroke-dasharray", `${((R.utilization(path, clock) ?? 0) * 38.96).toFixed(2)} 38.96`);
        const q = E.qmore.get(path);
        const slots = metas[view].queues[path]?.slots.length ?? 0;
        if (q) q.textContent = s.queue.length > slots ? `+${s.queue.length - slots}` : "";
        const wait = s.waitN ? s.waitSum / s.waitN : 0;
        const work = s.workN ? s.workSum / s.workN : 0;
        if (layer === "time" && per.heatWait && maxTime > 0) {
          const st = metas[view].stations[path];
          const ww = (wait / maxTime) * st.heat.w;
          const wk = (work / maxTime) * st.heat.w;
          per.heatWait.setAttribute("width", ww.toFixed(1));
          per.heatWork.setAttribute("x", (st.heat.x0 + ww).toFixed(1));
          per.heatWork.setAttribute("width", wk.toFixed(1));
        }
        const altW = metas[view].stations[path]?.altW ?? 100;
        if (layer === "time" && per.altTime) fitInto(per.altTime, !s.waitN ? "nothing yet" : wait < pace * 0.01 ? "no wait" : `waits ${fmt(wait)}`, altW);
        if (layer === "fail" && per.altFail) {
          const n = s.finished + s.timedOut + s.rejected;
          fitInto(per.altFail, n ? (bad ? `${pct(bad / n)} ${p.failLabel || "failed"}` : "none failed") : "nothing yet", altW);
        }
      } else if (p.kind === "end") {
        if (per.count) per.count.textContent = count(R.ends.get(path) || 0);
      } else if (p.kind === "start" && per.rate) {
        const now = startNow(path);
        const words = p.vus ? `${now.users} virtual user${now.users === 1 ? "" : "s"}` : now.paused ? "sends nothing" : rateWords(now.every, unit, perDot);
        if (per.rate.textContent !== words) per.rate.textContent = words;
      } else if (p.kind === "choice" && per.needle) {
        const c = R.choices.get(path);
        const a = c ? metas[view].gates[path]?.needle[c.last] : null;
        if (a != null) per.needle.style.transform = `rotate(${a}deg)`;
      }
    }
    const p50 = R.quantile(0.5);
    const zoom = basePace / pace;
    const slow = zoom > 1.5 ? ` · time ×1/${Math.round(zoom)}` : "";
    if (watch) {
      // the one number the figure is about, over the last few moments, then the usual
      const r = R.recent(recentSpan, clock).filter((f) => watched.has(f.cls));
      const lead = r.map((f) => f.lead).sort((a, b) => a - b);
      const qWord = watchQ === 0.5 ? "median" : `p${Math.round(watchQ * 100)}`;
      readout.textContent = `${fmt(clock)} in · ${watch.label} ${r.length ? pct(r.filter((f) => f.outcome === "ok").length / r.length) : "-"}${lead.length ? ` · ${qWord} ${fmt(lead[Math.min(lead.length - 1, Math.floor(lead.length * watchQ))])}` : ""} · ${count(counts().alive)} in flight${slow}`;
    } else readout.textContent = `${fmt(clock)} in · ${count(R.done)} done · ${count(R.alive.size)} in flight${R.done ? ` · median ${fmt(p50)}` : ""}${slow}`;
    refreshInspector();
    refreshPanel();
  }

  /**
   * Put text in an SVG text element, shrinking it a little, then cutting it,
   * to fit a width, measured with the font the reader actually has. A cut
   * text keeps its full words as a tooltip.
   */
  function fitInto(el, text, width, size = 10, min = 8.5, force = false) {
    if (!force && el.__text === text) return;
    el.__text = text;
    el.textContent = text;
    el.style.fontSize = "";
    if (!el.getComputedTextLength) return;
    let sz = size;
    if (el.getComputedTextLength() > width) {
      while (el.getComputedTextLength() > width && sz > min) {
        sz -= 0.5;
        el.style.fontSize = `${sz}px`;
      }
    }
    let t = text;
    while (el.getComputedTextLength() > width && t.length > 2) {
      t = t.slice(0, -1);
      el.textContent = `${t.trimEnd()}…`;
    }
    if (t !== text) {
      const tip = document.createElementNS(SVGNS, "title");
      tip.textContent = text;
      el.append(tip);
    }
  }

  /**
   * Fit a station's counters to the room its plate leaves them: a little
   * smaller first, then (on a flow row) on two lines, done over failed.
   */
  function fitCount(el) {
    if (!el.getComputedTextLength) return;
    const done = el.querySelector("[data-done]");
    const fails = el.querySelector("[data-fails]");
    let room = Number(el.dataset.room);
    if (el.dataset.afterSpec != null) {
      // on the spec's line: what the spec leaves of it
      const spec = el.closest(".dx-part")?.querySelector(".dx-spec");
      if (spec?.getComputedTextLength) room = Math.max(room, Number(el.getAttribute("x")) - (Number(spec.getAttribute("x")) + spec.getComputedTextLength() + 8));
    }
    if (!room) return;
    for (const t of [done, fails]) {
      t?.removeAttribute("x");
      t?.removeAttribute("y");
    }
    fails?.setAttribute("dx", "4");
    el.style.fontSize = "";
    let sz = 9.5;
    const shrink = (wide, min) => {
      while (wide() > room && sz > min) {
        sz -= 0.5;
        el.style.fontSize = `${sz}px`;
      }
    };
    shrink(() => el.getComputedTextLength(), el.dataset.two != null && fails?.textContent ? 8 : 7);
    if (el.getComputedTextLength() <= room || el.dataset.two == null || !fails?.textContent) return;
    const x = el.getAttribute("x");
    const y = Number(el.getAttribute("y"));
    done.setAttribute("x", x);
    done.setAttribute("y", (y - 5.2).toFixed(1));
    fails.setAttribute("x", x);
    fails.setAttribute("y", (y + 4.4).toFixed(1));
    fails.removeAttribute("dx");
    el.style.fontSize = "";
    sz = 9.5;
    shrink(() => Math.max(done.getComputedTextLength(), fails.getComputedTextLength()), 7);
  }

  /** Fit every word that has a fixed room (names, specs, lane labels) to the reader's font, and draw every tag to its words. */
  function fitWords() {
    for (const el of root.querySelectorAll("svg text[data-fit]")) fitInto(el, el.dataset.full, Number(el.dataset.fit), Number(el.dataset.size), Number(el.dataset.min), true);
    for (const el of root.querySelectorAll("svg .dx-count[data-room]")) fitCount(el);
    for (const g of root.querySelectorAll(".dx-tag")) {
      const t = g.querySelector("text");
      const r = g.querySelector("rect");
      const len = t?.getComputedTextLength?.();
      if (!len || !r) continue;
      const w = len + 14;
      r.setAttribute("width", w.toFixed(1));
      r.setAttribute("x", (Number(t.getAttribute("x")) - w / 2).toFixed(1));
    }
  }

  // ---- the inspector ------------------------------------------------------------------------------
  const kindName = { station: "Step", start: "Start", end: "End", choice: "Decision", split: "Parallel split", join: "Parallel join", timer: "Wait", store: "Store" };

  /** A chance in words: "12%", or by kind, "60% of bots, 0.2% of people". */
  function chanceWords(v) {
    if (typeof v === "number") return pctFine(v);
    const kinds = classNames.length ? classNames : Object.keys(v);
    return kinds
      .map((k) => [k, chanceOf(v, k)])
      .sort((a, b) => b[1] - a[1])
      .map(([k, x]) => `${pctFine(x)} of ${k}`)
      .join(", ");
  }

  /** A start's rate and pause as they stand at the clock: the model, then every change up to now. */
  function startNow(path) {
    const p = parts.get(path);
    let every = p.every;
    let paused = false;
    let vus = p.vus;
    let think = p.think;
    for (const r of R.changes) {
      if (r.at !== path || !r.set) continue;
      if (r.set.every != null) every = r.set.every;
      if ("paused" in r.set) paused = Boolean(r.set.paused);
      if (r.set.vus != null) vus = r.set.vus;
      if (r.set.think != null) think = r.set.think;
    }
    return { every, paused, vus, think, users: R.vus.get(path) ?? 0 };
  }
  /**
   * A choice as it stands at the clock: the route a change set it to take (null: it decides
   * itself), and its odds by route (null for a route decided by outcome).
   */
  function choiceNow(path) {
    const p = parts.get(path);
    const outs = levels.get(levelOf(path)).outs.get(p.id).filter((r) => !r.emit);
    let take = null;
    let set = null;
    for (const r of R.changes) {
      if (r.at !== path || !r.set) continue;
      if ("take" in r.set) take = r.set.take ?? null;
      if ("p" in r.set) set = r.set.p ?? null;
    }
    const total = set ? Object.values(set).reduce((a, b) => a + b, 0) : 1;
    const odds = new Map(outs.map((r) => [r.id, r.p == null ? null : set ? (set[r.id] ?? 0) / total : r.p]));
    // a way out at 100% leaves nothing to chance
    const sure = outs.find((r) => typeof odds.get(r.id) === "number" && odds.get(r.id) >= 1 - 1e-9) || null;
    return { outs, take: take != null ? outs.find((r) => r.id === take) || null : null, odds, sure };
  }
  /** A closed start's stages in words: "up to 20 in 30 s, 20 for 1 min, down to none in 20 s". */
  function stagesWords(stages) {
    let n = 0;
    return (stages || [])
      .map(([d, to]) => {
        const w = to === n ? `${to} for ${fmt(d)}` : to > n ? `up to ${to} in ${fmt(d)}` : `down to ${to || "none"} in ${fmt(d)}`;
        n = to;
        return w;
      })
      .join(", ");
  }

  const bornAt = (path) => R.bornAt.get(path) || 0;

  /**
   * How one kind of item fared lately: where it ended, the commonest first. An item and its
   * copies count once at each end they reached: a sample shown on two dashboards is 100% at
   * each, not half at each.
   */
  function fared(c) {
    const r = R.recent(recentSpan, clock).filter((f) => f.cls === c);
    if (!r.length) return "-";
    const items = new Set(r.map((f) => f.root));
    const by = new Map();
    for (const f of r) by.set(f.at, (by.get(f.at) || new Set()).add(f.root));
    return [...by]
      .map(([at, s]) => [at, s.size])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([at, n]) => `${pctFine(n / items.size)} ${parts.get(at)?.label ?? at}`)
      .join(", ");
  }

  // ---- a part's settings, on the figure -------------------------------------------------------
  // A part with dials, or servers that scale, keeps its settings in a panel next to it on the
  // drawing: what it is doing now, its dials, its switch. A click on the part opens it (its
  // badge, for a part that opens into a level); the close key, Escape or a click elsewhere
  // closes it, and so does going to another level.
  const viewEl = $(".dx-view");
  const dock = $(".dx-dock");
  const panel = document.createElement("div");
  panel.className = "dx-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  viewEl.append(panel);
  let panelFor = null;
  let panelLive = [];
  const settingsOf = (path) => {
    const p = parts.get(path);
    return p && (p.dials?.length || p.scale) ? p : null;
  };
  /** A scaling station's policy as it stands at the clock (null: no autoscaling). */
  function scaleNow(path) {
    const p = parts.get(path);
    let pol = p.scale ? { ...p.scale } : null;
    for (const r of R.changes) if (r.at === path && r.set && "scale" in r.set) pol = r.set.scale ? { ...(p.scale || {}), ...r.set.scale } : null;
    return pol;
  }
  function openPanel(path, { focus = false } = {}) {
    if (!settingsOf(path)) return closePanel();
    panelFor = path;
    panel.hidden = false;
    // the inspector draws the panel with it (and drops its pointer to the settings)
    renderInspector();
    for (const e of els.values()) for (const [p, g] of e.partEl) g.toggleAttribute("data-panel", p === panelFor);
    if (focus) (panel.querySelector('[data-ctl][aria-checked="true"]') || panel.querySelector("button"))?.focus();
  }
  function closePanel({ focus = false } = {}) {
    if (!panelFor) return;
    const was = panelFor;
    panelFor = null;
    panel.hidden = true;
    for (const e of els.values()) for (const g of e.partEl.values()) g.removeAttribute("data-panel");
    if (selected === was) renderInspector();
    if (focus) els.get(view)?.partEl.get(was)?.focus();
  }
  function renderPanel() {
    if (!panelFor) return;
    const p = parts.get(panelFor);
    // keep the reader's place when the panel is drawn again (after a choice)
    const had = panel.contains(document.activeElement) ? [document.activeElement.getAttribute("data-ctl"), document.activeElement.getAttribute("data-i")] : null;
    panelLive = [];
    const live = (fn) => {
      const k = `p${panelLive.length}`;
      panelLive.push([k, fn]);
      return `<span data-pk="${k}">${esc(fn())}</span>`;
    };
    let h = `<div class="dx-panel-head"><span><span class="dx-panel-kind">Settings</span><span class="dx-panel-title">${esc(p.label)}</span></span><button type="button" class="dx-key dx-icon" data-panel-close title="Close (Escape)" aria-label="Close the settings of ${esc(p.label)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>`;
    if (p.scale) {
      const pol = scaleNow(panelFor);
      h += `<div class="dx-panel-live"><span class="dx-cells" data-cells aria-hidden="true">${"<i></i>".repeat(p.scale.max)}</span>${live(() => serversWords(panelFor))}</div>`;
      h += pol ? `<p class="dx-panel-note">${esc(`Every ${fmt(meanOf(pol.every ?? model.horizon / 40))} it looks at the work that came in, and starts servers to keep them about ${pct(pol.target ?? 0.6)} busy, up to ${pol.max}; a new one takes ${pol.boot != null ? describe(pol.boot, unit) : "a while"} to start.`)}</p>` : `<p class="dx-panel-note">Autoscaling is off: the servers running stay, and no more start.</p>`;
    } else if (p.kind === "start" && p.vus) h += `<div class="dx-panel-live">${live(() => `Now: ${startNow(panelFor).users} virtual users`)}</div><p class="dx-panel-note">${esc(`Stages: ${stagesWords(startNow(panelFor).vus)}.`)}</p>`;
    else if (p.kind === "start") h += `<div class="dx-panel-live">${live(() => (startNow(panelFor).paused ? "It sends nothing now." : `Now: ${rateWords(startNow(panelFor).every, unit, perDot)}`))}</div>`;
    else if (p.kind === "station") h += `<div class="dx-panel-live">${live(() => `busy ${pct(R.utilization(panelFor, clock))}, ${count(R.st.get(panelFor)?.queue.length ?? 0)} waiting`)}</div>`;
    h += controlsHtml(controls.filter((c) => c.path === panelFor), false);
    panel.innerHTML = h;
    panel.setAttribute("aria-label", `Settings of ${p.label}`);
    refreshPanel();
    if (had) panel.querySelector(`[data-ctl="${had[0]}"][data-i="${had[1]}"]`)?.focus();
  }
  function serversWords(path) {
    const s = R.st.get(path);
    const pol = scaleNow(path);
    return `${s.servers} running${s.booting ? `, ${s.booting} starting` : ""}; ${pol ? `up to ${pol.max}` : "autoscaling off"}; busy ${pct(R.utilization(path, clock))}`;
  }
  function refreshPanel() {
    if (!panelFor || panel.hidden) return;
    for (const [k, fn] of panelLive) {
      const el = panel.querySelector(`[data-pk="${k}"]`);
      if (el) el.textContent = fn();
    }
    const cells = panel.querySelector("[data-cells]");
    if (cells) {
      const s = R.st.get(panelFor);
      const max = scaleNow(panelFor)?.max ?? s.servers;
      [...cells.children].forEach((c, i) => {
        c.className = i < s.servers ? "dx-run" : i < s.servers + s.booting ? "dx-boot" : i >= max ? "dx-out" : "";
      });
    }
  }
  /** Next to its part: under it, else over it; on a narrow card, at the bottom of the drawing. */
  function placePanel() {
    if (!panelFor || panel.hidden) return;
    const g = els.get(view)?.partEl.get(panelFor);
    if (!g) return closePanel();
    const vr = viewEl.getBoundingClientRect();
    const pr = g.getBoundingClientRect();
    const top0 = stage.getBoundingClientRect().top - vr.top;
    const floor = dock.getBoundingClientRect().top - vr.top;
    const narrow = vr.width < 560;
    panel.style.width = narrow ? `${Math.round(vr.width - 16)}px` : "";
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let left;
    let top;
    if (narrow) {
      left = 8;
      top = Math.max(top0 + 8, floor - h - 8);
    } else {
      left = Math.min(Math.max(8, pr.left - vr.left + pr.width / 2 - w / 2), vr.width - w - 8);
      const below = pr.bottom - vr.top + 10;
      const above = pr.top - vr.top - 10 - h;
      top = below + h <= floor - 6 ? below : above >= top0 + 6 ? above : Math.max(top0 + 6, Math.min(below, floor - h - 6));
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
  stage.addEventListener("scroll", placePanel, { passive: true });

  /** The reader's controls (switches and dials) as rows of options; `named` puts the part's name in each. */
  function controlsHtml(list, named) {
    if (!list.length) return "";
    let h = `<div class="dx-dials">`;
    for (const c of list) {
      const label = c.kind === "switch" ? (named ? c.name : "On or off") : named ? `${c.part.label}: ${c.dial.label}` : c.dial.label;
      const options = c.kind === "switch" ? ["on", "off"] : c.dial.options.map((o) => o.label);
      const at = c.kind === "switch" ? (settings.get(c.key) ? 0 : 1) : settings.get(c.key);
      // a switch fits on one line with its name; a dial's options go under its label
      h += `<div class="dx-dial${c.kind === "switch" ? " dx-dial-row" : ""}"><span class="dx-dial-label">${esc(label)}</span><span class="dx-seg" role="radiogroup" aria-label="${esc(label)}">`;
      options.forEach((o, i) => (h += `<button type="button" role="radio" aria-checked="${i === at}" data-ctl="${esc(c.key)}" data-i="${i}">${esc(o)}</button>`));
      h += `</span></div>`;
    }
    return `${h}</div>`;
  }

  function stationWords(p) {
    if (isOff(p.path)) return "Switched off: everything passes straight through, with no work and no waiting.";
    if (p.inside) return `A process of its own (${p.inside.parts.filter((q) => q.kind === "station").length} steps). Click it to go inside.`;
    if (p.scale) {
      const sc = p.scale;
      return `Scales between ${sc.min} and ${sc.max} servers: it starts more when they would be over ${pct(sc.target ?? 0.6)} busy, and a new one takes ${sc.boot != null ? describe(sc.boot, unit) : "a while"} to be ready. Each ${noun} takes ${describe(p.work, unit)}${p.patience != null ? `; ${plural} give up after waiting ${short(p.patience, unit)}` : ""}.`;
    }
    const cap = Number.isFinite(p.servers) ? (p.servers === 1 ? "One item at a time" : `${p.servers} items at a time`) : "No limit on how many at once";
    const extra = [];
    if (p.fail) extra.push(`${chanceWords(p.fail)} ${p.failLabel || "fail"}`);
    if (p.patience != null) extra.push(`items give up after waiting ${short(p.patience, unit)}`);
    if (p.capacity != null) extra.push(`room for ${p.capacity} in the queue`);
    return `${cap}; each takes ${describe(p.work, unit)}${extra.length ? `; ${extra.join("; ")}` : ""}.`;
  }

  /** Waiting so far at a station: what finished waiting, plus what is still in its queue. */
  function waitedAt(s) {
    let sum = s.waitSum;
    let n = s.waitN;
    for (const id of s.queue) {
      const t = R.tokens.get(id);
      if (t?.queuedAt != null) {
        sum += clock - t.queuedAt;
        n += 1;
      }
    }
    return { sum, n };
  }
  function bottleneck(within = "") {
    let best = null;
    let total = 0;
    const prefix = within ? `${within}/` : "";
    for (const [path, s] of R.st) {
      if (!path.startsWith(prefix)) continue;
      const w = waitedAt(s);
      total += w.sum;
      if (w.n && (!best || w.sum > best.w.sum)) best = { path, w };
    }
    if (!best || best.w.sum <= 0) return null;
    return { path: best.path, share: best.w.sum / total, wait: best.w.sum / best.w.n, util: R.utilization(best.path, clock) };
  }

  function actionsFor(p) {
    const acts = [];
    const base = parts.get(p.path);
    if (isOff(p.path)) return acts;
    if (p.kind === "station" && Number.isFinite(p.servers)) {
      const cur = R.st.get(p.path)?.servers ?? p.servers;
      // a station that scales sets its own number of servers (its dials change how)
      if (p.scale) {
        /* no capacity what-ifs */
      } else if (cur >= 4) {
        // with many at once, plus or minus one is noise: halve it or double it
        acts.push(["Twice as many at once", () => inject({ part: p.path, set: { servers: cur * 2 } }, `${p.label} now takes ${cur * 2} at a time.`)]);
        acts.push(["Half as many", () => inject({ part: p.path, set: { servers: Math.max(1, Math.floor(cur / 2)) } }, `${p.label} now takes ${Math.max(1, Math.floor(cur / 2))} at a time.`)]);
      } else {
        acts.push(["One more at a time", () => inject({ part: p.path, set: { servers: cur + 1 } }, `${p.label} now takes ${cur + 1} at a time.`)]);
        if (cur > 1) acts.push(["One fewer", () => inject({ part: p.path, set: { servers: cur - 1 } }, `${p.label} now takes ${cur - 1} at a time.`)]);
      }
      const out = options.outage ?? Math.max(1, Math.round(model.horizon / 8));
      acts.push([`Outage for ${fmt(out)}`, () => inject([{ part: p.path, set: { servers: 0 } }, { part: p.path, set: { servers: cur }, t: clock + out }], `${p.label} is down for ${fmt(out)}.`)]);
    }
    if (p.kind === "station" && !p.inside) {
      acts.push(["Twice as slow", () => inject({ part: p.path, set: { work: scaleSpec(base.work, 2) } }, `${p.label} now takes twice as long.`)]);
      acts.push(["Twice as fast", () => inject({ part: p.path, set: { work: scaleSpec(base.work, 0.5) } }, `${p.label} now takes half as long.`)]);
      if (p.fail) acts.push(["Never fails", () => inject({ part: p.path, set: { fail: 0 } }, `${p.label} no longer fails.`)]);
    }
    if (p.kind === "start" && p.vus && !levelOf(p.path)) {
      const now = startNow(p.path).vus;
      const scaled = (k) => now.map(([d, n]) => [d, Math.max(0, Math.round(n * k))]);
      acts.push(["Twice the virtual users", () => inject({ part: p.path, set: { vus: scaled(2) } }, "Twice the virtual users from now on.")]);
      acts.push(["Half the virtual users", () => inject({ part: p.path, set: { vus: scaled(0.5) } }, "Half the virtual users from now on.")]);
    }
    // a start that sends nothing has no rate to change: its dial lets it go first
    if (p.kind === "start" && p.every != null && !levelOf(p.path) && !startNow(p.path).paused) {
      // from the rate it has now (a dial or an earlier what-if may have set it)
      const every = startNow(p.path).every;
      acts.push(["50% more work", () => inject({ part: p.path, set: { every: scaleSpec(every, 1 / 1.5) } }, "Work now arrives 50% more often.")]);
      acts.push(["Half the work", () => inject({ part: p.path, set: { every: scaleSpec(every, 2) } }, "Work now arrives half as often.")]);
      // a burst: three times the work for a while, then back to what it was
      const span = options.burst ?? Math.max(1e-6, model.horizon / 10);
      acts.push([`A burst (${fmt(span)})`, () => inject([{ part: p.path, set: { every: scaleSpec(every, 1 / 3) } }, { part: p.path, set: { every }, t: clock + span }], `Three times the work for ${fmt(span)}.`)]);
      // with several kinds of work: half of one kind stops arriving (the rest arrive as before)
      const mix = Object.entries(p.classes || {});
      if (mix.length > 1) {
        const total = mix.reduce((a, [, w]) => a + w, 0);
        for (const [c, w] of mix) {
          const kept = total - w / 2;
          acts.push([`Half the ${c}`, () => inject({ part: p.path, set: { classes: { ...p.classes, [c]: w / 2 }, every: scaleSpec(every, total / kept) } }, `Half the ${c} no longer arrives.`)]);
        }
      }
    }
    if (p.kind === "choice") {
      // decisions by chance: shift the odds of the rarer way
      const lv = levels.get(levelOf(p.path));
      const now = choiceNow(p.path);
      const outs = now.outs;
      // not where a setting picks the way, or one way is certain: its odds are not chance
      if (!now.take && !now.sure && outs.every((r) => typeof r.p === "number")) {
        const cur = now.odds;
        const rare = outs.slice().sort((a, b) => cur.get(a.id) - cur.get(b.id))[0];
        const name = rare.label || (rare.id.includes(">") ? lv.byId.get(rare.to).label : rare.id);
        const shift = (k) => {
          const q = Math.min(0.95, Math.max(0.01, cur.get(rare.id) * k));
          const others = outs.filter((r) => r !== rare);
          const sum = others.reduce((a, r) => a + cur.get(r.id), 0);
          const set = { [rare.id]: q };
          for (const r of others) set[r.id] = sum > 0 ? ((1 - q) * cur.get(r.id)) / sum : (1 - q) / others.length;
          return set;
        };
        acts.push([`${name} twice as often`, () => inject({ part: p.path, set: { p: shift(2) } }, `${p.label}: ${name} is now ${pct(shift(2)[rare.id])} of the time.`)]);
        acts.push([`${name} half as often`, () => inject({ part: p.path, set: { p: shift(0.5) } }, `${p.label}: ${name} is now ${pct(shift(0.5)[rare.id])} of the time.`)]);
      }
    }
    if (p.kind === "timer") {
      acts.push(["Wait twice as long", () => inject({ part: p.path, set: { wait: scaleSpec(base.wait, 2) } }, `${p.label} now waits twice as long.`)]);
      acts.push(["Wait half as long", () => inject({ part: p.path, set: { wait: scaleSpec(base.wait, 0.5) } }, `${p.label} now waits half as long.`)]);
    }
    return acts;
  }

  let refreshers = [];
  function renderInspector() {
    refreshers = [];
    const val = (fn) => {
      const k = `v${refreshers.length}`;
      refreshers.push([k, fn]);
      return `<dd data-k="${k}">${esc(fn())}</dd>`;
    };
    let html = "";
    let acts = [];
    if (followed && !idleFollow) {
      const tok = R.tokens.get(followed);
      html += `<div class="dx-kind">Following</div><h3>${esc(noun[0].toUpperCase() + noun.slice(1))} ${esc(followed)}</h3>`;
      html += `<dl>${classNames.length > 1 ? `<dt>kind</dt><dd>${esc(tok?.cls ?? "")}</dd>` : ""}<dt>arrived</dt><dd>${esc(fmt(tok?.born ?? 0))} in</dd><dt>so far</dt>${val(() => {
        const t = R.tokens.get(followed);
        return t ? fmt((t.doneAt ?? clock) - t.born) : "-";
      })}<dt>now</dt>${val(() => whereIs(followed))}</dl>`;
      html += `<ol class="dx-journey" data-journey></ol>`;
      acts.push(["Stop following", () => setFollow(null)]);
      acts.push([followInside ? "Stay on this level" : "Go inside with it", () => ((followInside = !followInside), renderInspector())]);
    } else if (selected && parts.get(selected) && !(selected === view && view)) {
      const p = parts.get(selected);
      const emits = () => {
        const lv = levels.get(levelOf(selected));
        return (lv.outs.get(p.id) || [])
          .filter((r) => r.emit)
          .map((r) => `<dt>${esc(`new ${r.emit} → ${lv.byId.get(r.to).label}`)}</dt>${val(() => `${count(R.passes.get(`${lv.path}::${r.id}`) || 0)} sent`)}`)
          .join("");
      };
      html += `<div class="dx-kind">${esc(kindName[p.kind] || p.kind)}</div><h3>${esc(p.label)}</h3>`;
      if (p.about) html += `<p>${esc(p.about)}</p>`;
      if (p.kind === "station") {
        html += `<p>${esc(stationWords(p))}</p><dl>`;
        html += `<dt>waiting now</dt>${val(() => count(R.st.get(selected)?.queue.length ?? 0))}`;
        html += `<dt>in work now</dt>${val(() => count(R.st.get(selected)?.busy ?? 0))}`;
        html += `<dt>done</dt>${val(() => count(R.st.get(selected)?.finished ?? 0))}`;
        if (Number.isFinite(p.servers)) html += `<dt>busy</dt>${val(() => pct(R.utilization(selected, clock)))}`;
        if (p.scale)
          html += `<dt>servers</dt>${val(() => {
            const s = R.st.get(selected);
            return `${s.servers} running${s.booting ? `, ${s.booting} starting` : ""}`;
          })}`;
        if (p.switch) html += `<dt>passed while off</dt>${val(() => count(R.st.get(selected)?.passed ?? 0))}`;
        html += `<dt>average wait</dt>${val(() => {
          const s = R.st.get(selected);
          return s?.waitN ? fmt(s.waitSum / s.waitN) : "-";
        })}`;
        if (p.fail || p.patience != null || p.capacity != null)
          html += `<dt>${esc(p.failLabel || "came out failed")}</dt>${val(() => {
            const s = R.st.get(selected);
            const n = s.finished + s.timedOut + s.rejected;
            return n ? pct((s.failed + s.timedOut + s.rejected) / n) : "-";
          })}`;
        html += `${emits()}</dl>`;
      } else if (p.kind === "choice") {
        const lv = levels.get(levelOf(selected));
        const now = choiceNow(selected);
        const outs = now.outs;
        const toOf = (r) => lv.byId.get(r.to).label;
        const byKind = outs.some((r) => r.p != null && typeof r.p === "object");
        const off = isOff(selected) && outs.find((r) => r.bypass);
        // set to one way (by a dial, or a change), or one way at 100%: nothing is decided here
        const one = !off && (now.take || now.sure);
        html += `<p>${esc(off ? `Switched off: everything goes to ${toOf(off)}.` : one ? `Sends everything to ${toOf(one)}.` : outs.some((r) => r.p != null) ? (byKind ? "Decides by chance, and the chance depends on the kind of item:" : "Decides by chance:") : "Decides by how the item did:")}</p><dl>`;
        for (const r of outs) {
          const key = `${lv.path}::${r.id}`;
          const pNow = now.odds.get(r.id);
          const rule = off || one ? "" : r.p != null ? (typeof pNow === "object" ? chanceWords(pNow) : `${Math.round(pNow * 100)}%`) : r.when === "else" || r.when == null ? "otherwise" : r.when.startsWith("class:") ? r.when.slice(6) : r.when.startsWith("late:") ? `after ${fmt(Number(r.when.slice(5)))} or more` : `if ${r.when}`;
          html += `<dt>${rule ? `${esc(rule)}${r.max ? ` (at most ${r.max}×)` : ""} ` : ""}→ ${esc(toOf(r))}</dt>${val(() => {
            const c = R.choices.get(selected);
            const total = c ? Object.values(c.counts).reduce((a, b) => a + b, 0) : 0;
            return total ? `${pct((c.counts[key] || 0) / total)} so far` : "-";
          })}`;
        }
        html += `${emits()}</dl>`;
        const by = p.switch && !off && outs.find((r) => r.bypass);
        if (by) html += `<p>${esc(`Its switch turns it off: then everything goes to ${toOf(by)}.`)}</p>`;
      } else if (p.kind === "start" && p.vus) {
        const now = startNow(selected);
        html += `<p>${esc(`A closed load: virtual users ${stagesWords(now.vus)}. Each one sends its ${noun}, waits for the answer, pauses ${now.think != null ? describe(now.think, unit) : "no time"}, and sends the next; a slower answer means fewer ${plural} a ${unit === "s" ? "second" : unit}.`)}</p><dl><dt>virtual users now</dt>${val(() => String(startNow(selected).users))}<dt>sent</dt>${val(() => count(bornAt(selected)))}</dl>`;
      } else if (p.kind === "start" && p.every != null) {
        const now = startNow(selected);
        const how = now.paused ? "It sends nothing now." : perDot > 1 ? `About ${compact(perDot / meanOf(now.every))} ${plural} arrive each ${unit === "s" ? "second" : unit}; each dot is ${perDot} of them.` : `New work arrives every ${describe(now.every, unit)}${p.count ? `, ${p.count} items in all` : ""}.`;
        html += `<p>${esc(how)}</p><dl><dt>arrived</dt>${val(() => count(bornAt(selected)))}</dl>`;
      } else if (p.kind === "end") {
        html += `<dl><dt>arrived here</dt>${val(() => count(R.ends.get(selected) || 0))}</dl>`;
      } else if (p.kind === "timer") {
        html += `<p>Holds each item ${esc(describe(p.wait, unit))}.</p><dl><dt>waiting now</dt>${val(() => count(R.timers.get(selected)?.size ?? 0))}</dl>`;
      } else if (p.kind === "join") {
        html += `<p>An item goes on only when every branch of its split has arrived. It is as late as its slowest branch.</p>`;
      } else if (p.kind === "split") {
        html += `<p>Each item becomes one item per branch, all at once.</p>`;
      }
      if (settingsOf(selected) && panelFor !== selected) html += `<p>Its settings are on the figure, next to it: click it, or press Enter.</p>`;
      acts = actionsFor(p);
    } else {
      const holder = view ? parts.get(view) : null;
      html += `<div class="dx-kind">${view ? "Inside" : "The process"}</div><h3>${esc(holder ? holder.label : model.title || "Process")}</h3>`;
      const about = holder ? holder.about : model.raw.about;
      if (about) html += `<p>${esc(about)}</p>`;
      if (holder) {
        // this level's own numbers: the station that holds it
        const S = () => R.st.get(view);
        html += `<dl><dt>done</dt>${val(() => count(S().finished))}<dt>inside now</dt>${val(() => count(S().busy))}<dt>average time inside</dt>${val(() => (S().workN ? fmt(S().workSum / S().workN) : "-"))}`;
        if (Number.isFinite(holder.servers)) html += `<dt>waiting to get in</dt>${val(() => count(S().queue.length))}`;
        html += `</dl>`;
      } else {
        const done = narrowed ? `${plural} done` : "done";
        html += `<dl><dt>${esc(done)}</dt>${val(() => count(counts().done))}<dt>in flight</dt>${val(() => count(counts().alive))}<dt>median time</dt>${val(() => (counts().done ? fmt(counts().q(0.5)) : "-"))}<dt>slowest 5%</dt>${val(() => (counts().done >= 5 ? `over ${fmt(counts().q(0.95))}` : "-"))}</dl>`;
        // with several kinds of item: how each kind has fared lately, by where it ended; a kind
        // shows once this run has made one (a dial can change which kinds there are)
        if (classNames.length > 1) {
          html += `<div class="dx-fared" hidden><div class="dx-kind">In the last ${esc(fmt(recentSpan))}</div><dl>`;
          for (const c of classNames) html += `<div data-kind="${esc(c)}" hidden><dt>${esc(c)}</dt>${val(() => fared(c))}</div>`;
          html += `</dl></div>`;
        }
      }
      const words = () => bottleneckWords(view);
      html += `<p data-k="b">${esc(words())}</p>`;
      refreshers.push(["b", words]);
      if (changes.length) html += `<p>Your what-ifs run from the moment you made them; everything before is the run as modelled.</p>`;
      if (holder) acts = actionsFor(holder);
    }
    if (changes.length) acts.push(["Undo what-ifs", undo]);
    inspector.innerHTML = html + (acts.length ? `<div class="dx-acts"></div>` : "");
    const box = inspector.querySelector(".dx-acts");
    for (const [label, fn] of acts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dx-btn";
      b.textContent = label;
      b.addEventListener("click", () => {
        touch();
        fn();
      });
      box.append(b);
    }
    refreshInspector(true);
    if (panelFor) {
      renderPanel();
      placePanel();
    }
  }

  function bottleneckWords(within = "") {
    const b = bottleneck(within);
    if (!b) {
      // where every step takes each item as it comes, nothing can wait: say so, rather than "yet"
      const limited = [...parts.values()].some((q) => q.kind === "station" && !q.inside && (Number.isFinite(q.servers) || q.scale) && (!within || q.path.startsWith(`${within}/`)));
      if (!limited) return within ? `Nothing waits in here: its steps take each ${noun} as it comes.` : `Nothing waits here: every step takes each ${noun} as it comes, so the time is the work itself.`;
      return within ? "Nothing has had to wait in here yet." : "Watch the queues: where items wait is where the time goes.";
    }
    // waiting that is a sliver of the time spent is not worth a sentence about where it is
    const s = within ? R.st.get(within) : null;
    const typical = within ? (s?.workN ? s.workSum / s.workN : 0) : R.done ? R.quantile(0.5) : 0;
    if (typical > 0 && b.wait < typical * 0.02) return within ? "Items barely wait in here: their time is the work itself." : "Items barely wait: their time is the work itself and the trips between steps.";
    const p = parts.get(b.path);
    const inner = levelOf(b.path) !== within;
    const where = inner ? `${p.label} (inside ${parts.get(levelOf(b.path)).label})` : p.label;
    return `Most of the waiting${within ? " in here" : ""} is for ${where}: ${pct(b.share)} of it, ${fmt(b.wait)} per item on average${b.util != null ? `, busy ${pct(b.util)} of the time` : ""}.`;
  }

  function whereIs(id) {
    const t = R.tokens.get(id);
    if (!t) return "-";
    const name = (path) => parts.get(path)?.label ?? path;
    switch (t.mode) {
      case "move":
        return `on its way to ${name(t.at)}`;
      case "queue":
        return `waiting for ${name(t.at)} (${R.st.get(t.at).queue.indexOf(id) + 1} in line)`;
      case "serve":
        return `at ${name(t.at)}`;
      case "inside":
        return `inside ${name(t.at)}`;
      case "wait":
        return `waiting at ${name(t.at)}`;
      case "joinwait":
        return `waiting for its other branches at ${name(t.at)}`;
      case "forked":
        return "split into parallel branches";
      case "done":
        return `done: ${name(t.at)}`;
      default:
        return name(t.at);
    }
  }

  let journeyN = -1;
  function refreshInspector(force = false) {
    for (const [k, fn] of refreshers) {
      const el = inspector.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = fn();
    }
    const kinds = inspector.querySelector(".dx-fared");
    if (kinds) {
      for (const row of kinds.querySelectorAll("[data-kind]")) row.hidden = !R.kindsBorn.has(row.getAttribute("data-kind"));
      kinds.hidden = R.kindsBorn.size < 2;
    }
    const list = inspector.querySelector("[data-journey]");
    if (list && followed) {
      const rows = journeyOf(followed);
      if (force || rows.length !== journeyN) {
        journeyN = rows.length;
        list.innerHTML = rows.map(([t, text]) => `<li><time>${esc(fmt(t))}</time><span>${esc(text)}</span></li>`).join("");
        list.scrollTop = list.scrollHeight;
      }
    }
  }

  /** The part a route leads to, by its key "<level>::<route id>". */
  function targetOf(key) {
    const i = key.indexOf("::");
    const lv = levels.get(key.slice(0, i));
    const r = lv?.routes.find((q) => q.id === key.slice(i + 2));
    return r ? (lv.path ? `${lv.path}/${r.to}` : r.to) : key;
  }

  function journeyOf(id) {
    const ids = [id];
    let t = R.tokens.get(id);
    while (t?.parent) {
      ids.push(t.parent);
      t = R.tokens.get(t.parent);
    }
    const mine = new Set(ids);
    const name = (path) => parts.get(path)?.label ?? path;
    const rows = [];
    const log = R.log;
    for (let i = 0; i < R.i; i++) {
      const r = log[i];
      if (!mine.has(r.tok)) continue;
      if (r.tok !== id && rows.length && r.k === "split") {
        rows.push([r.t, `split into ${r.children.length} parallel branches at ${name(r.at)}`]);
        continue;
      }
      const words = {
        born: () => `arrived at ${name(r.at)}`,
        queue: () => `joined the queue for ${name(r.at)}`,
        start: () => (r.t1 == null ? `went into ${name(r.at)}` : `started ${name(r.at)}`),
        finish: () => (r.outcome === "ok" ? `finished ${name(r.at)}` : `${name(r.at)}: ${r.outcome}`),
        renege: () => `gave up waiting for ${name(r.at)}`,
        reject: () => `turned away at ${name(r.at)}: no room`,
        decide: () => `${name(r.at)}: on to ${name(targetOf(r.route))}`,
        split: () => `split into ${r.children.length} parallel branches`,
        join: () => `all branches met at ${name(r.at)}`,
        wait: () => `waits at ${name(r.at)}`,
        pass: () => `passed through ${name(r.at)}, which is switched off`,
        done: () => `ended: ${name(r.at)}${r.outcome !== "ok" && r.outcome !== parts.get(r.at)?.outcome ? ` (${r.outcome})` : ""}`,
      }[r.k];
      if (words) rows.push([r.t, words()]);
    }
    return rows;
  }

  // ---- controls: a strip of keys under the drawing, built once and updated in place ----------------------
  const ICON = {
    play: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.4v9.2l7.4-4.6z" style="fill:currentColor"/></svg>`,
    pause: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 3.6v8.8M10.4 3.6v8.8"/></svg>`,
    step: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 3.6v8.8l6.2-4.4zM12.2 3.6v8.8"/></svg>`,
    restart: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 8.2a4.6 4.6 0 1 0 1.5-3.4M3.4 2.8v2.8h2.8"/></svg>`,
  };
  const key = (html, label, fn, cls = "dx-key dx-icon") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.innerHTML = html;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => {
      touch();
      fn();
    });
    keys.append(b);
    return b;
  };
  const playKey = key(ICON.pause, "Pause (Space)", () => (playing ? pause() : play()));
  key(ICON.step, "Step to the next event (.)", () => step());
  const speedKey = key("1×", "Speed (+ and -)", () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]), "dx-key");
  const seg = document.createElement("span");
  seg.className = "dx-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Layer");
  const layerKeys = {};
  for (const [k, label, title] of [
    ["flow", "Flow", "Flow: the items as they move"],
    ["time", "Time", "Time: where each step's time goes"],
    ["fail", "Failures", "Failures: where work comes out failed"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", () => {
      touch();
      setLayer(k);
    });
    seg.append(b);
    layerKeys[k] = b;
  }
  keys.append(seg);
  key(ICON.restart, "Restart from the beginning", () => restart(false));
  function renderControls() {
    playKey.innerHTML = playing ? ICON.pause : ICON.play;
    const pl = playing ? "Pause (Space)" : "Play (Space)";
    playKey.title = pl;
    playKey.setAttribute("aria-label", pl);
    speedKey.textContent = `${speed}×`;
    for (const [k, b] of Object.entries(layerKeys)) b.setAttribute("aria-pressed", String(layer === k));
  }

  // ---- public handle --------------------------------------------------------------------------------
  function play() {
    if (R.next === Infinity && R.alive.size === 0 && clock > model.horizon) restart(true);
    playing = true;
    renderControls();
    wake();
  }
  function clearPulses() {
    for (const p of pulses) for (const e of els.values()) e.routeEl.get(p.key)?.classList.remove("dx-pass");
    pulses.length = 0;
  }
  function pause() {
    playing = false;
    clearPulses();
    renderControls();
  }
  function step() {
    playing = false;
    clearPulses();
    sim.runUntil(clock + lookahead());
    const t = R.next;
    if (Number.isFinite(t)) clock = t;
    glides.clear();
    renderControls();
    R.advance(clock);
    events(R.drain());
    draw();
    drawSlow();
  }
  function setSpeed(k) {
    speed = k;
    renderControls();
    announce(`Speed ${k}×.`);
  }
  function setLayer(k) {
    layer = k;
    root.setAttribute("data-layer", k);
    renderControls();
    drawSlow();
    hint.textContent = { flow: hintText, time: "Time: each bar is where an item's time goes at that step, waiting (orange) then working.", fail: "Failures: the red rails carry failed work; each step says how much of its work came out failed." }[k];
  }
  /** Tell the page what the reader did (another figure can listen: "dissect:select", "dissect:open", "dissect:follow"). */
  function emit(type, detail) {
    root.dispatchEvent(new CustomEvent(`dissect:${type}`, { bubbles: true, detail }));
  }
  function select(path) {
    if (panelFor && path !== panelFor) closePanel();
    selected = path;
    emit("select", { path, part: path ? parts.get(path) : null });
    for (const e of els.values()) for (const [p, g] of e.partEl) g.classList.toggle("dx-sel", p === path);
    if (followed && !idleFollow) setFollow(null);
    else renderInspector();
  }
  function announce(text) {
    say.textContent = "";
    setTimeout(() => (say.textContent = text), 30);
  }
  function touch() {
    lastInteraction = performance.now();
    if (idleFollow) setFollow(null);
    wake();
  }

  // ---- input ---------------------------------------------------------------------------------------
  const hintText = options.hint || hint.textContent || "Click a step to read it. Open the ones with a window. Click a dot to follow it.";
  hint.textContent = hintText;
  stage.addEventListener("pointerdown", touch);
  stage.addEventListener("click", (e) => {
    const gear = e.target.closest("[data-settings]");
    if (gear) {
      const path = gear.getAttribute("data-settings");
      if (selected !== path) select(path);
      openPanel(path);
      return;
    }
    const sw = e.target.closest("[data-switch]");
    if (sw) {
      // turning a part off or on selects it, and never opens it
      const path = sw.getAttribute("data-switch");
      toggle(path);
      if (selected !== path) select(path);
      return;
    }
    const tokEl = e.target.closest("[data-tok]");
    if (tokEl) {
      setFollow(tokEl.getAttribute("data-tok"));
      return;
    }
    const g = e.target.closest(".dx-part");
    if (g) {
      const path = g.getAttribute("data-path");
      if (g.getAttribute("data-open") === "1") {
        select(path);
        setView(path, { focus: false });
      } else {
        select(path);
        // a part with settings opens them, next to it
        if (settingsOf(path)) openPanel(path);
      }
      return;
    }
    select(null);
  });
  stage.addEventListener("focusin", (e) => {
    const g = e.target.closest?.(".dx-part");
    if (g) select(g.getAttribute("data-path"));
  });
  // a control in the panel (or anywhere in the card) sets what it names
  const onControl = (e) => {
    if (e.target.closest("[data-panel-close]")) {
      touch();
      closePanel({ focus: true });
      return;
    }
    const b = e.target.closest("[data-ctl]");
    if (!b) return;
    touch();
    const c = controlOf.get(b.getAttribute("data-ctl"));
    const i = Number(b.getAttribute("data-i"));
    if (c.kind === "switch") {
      if (settings.get(c.key) !== (i === 0)) toggle(c.path);
    } else chooseOption(c.key, i);
  };
  inspector.addEventListener("click", onControl);
  panel.addEventListener("click", onControl);
  root.addEventListener("keydown", (e) => {
    if (e.target.closest?.("button") && (e.key === " " || e.key === "Enter")) return;
    const swEl = e.target.closest?.("[data-switch]");
    if (swEl && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      touch();
      toggle(swEl.getAttribute("data-switch"));
      return;
    }
    const gearEl = e.target.closest?.("[data-settings]");
    if (gearEl && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      touch();
      openPanel(gearEl.getAttribute("data-settings"), { focus: true });
      return;
    }
    // Escape closes the settings first, and takes the reader back to their part
    if (e.key === "Escape" && panelFor) {
      touch();
      closePanel({ focus: true });
      return;
    }
    touch();
    const g = e.target.closest?.(".dx-part");
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.key === "Enter" && g) {
      e.preventDefault();
      const path = g.getAttribute("data-path");
      if (g.getAttribute("data-open") === "1") setView(path, { focus: true });
      else {
        select(path);
        if (settingsOf(path)) openPanel(path, { focus: true });
      }
    } else if (e.key === "Escape") {
      if (followed && !idleFollow) setFollow(null);
      else if (view) setView(levelOf(view), { focus: true, from: view });
      else select(null);
    } else if (e.key === ".") {
      e.preventDefault();
      step();
    } else if (e.key === "+" || e.key === "=") setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
    else if (e.key === "-") setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
    else if (e.key === "f" && g) {
      const path = g.getAttribute("data-path");
      const s = R.st.get(path);
      const id = s?.bays.find(Boolean)?.tok || s?.queue[0];
      if (id) setFollow(id);
    } else if (g && e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveFocus(g, e.key);
    }
  });

  function moveFocus(g, key) {
    const meta = metas[view];
    const here = meta.parts[g.getAttribute("data-path")];
    let best = null;
    for (const [path, p] of Object.entries(meta.parts)) {
      if (p === here) continue;
      const dx = p.x - here.x;
      const dy = p.y - here.y;
      const along = key === "ArrowRight" ? dx : key === "ArrowLeft" ? -dx : key === "ArrowDown" ? dy : -dy;
      const across = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) continue;
      const score = along + across * 2.2;
      if (!best || score < best.score) best = { path, score };
    }
    if (best) els.get(view).partEl.get(best.path)?.focus();
  }

  // ---- size: readable, never tiny --------------------------------------------------------------------
  function fit() {
    const w = stage.clientWidth;
    if (!w) return;
    for (const [lv, svg] of sheets) {
      const m = metas[lv];
      if (!m) continue;
      const width = m.width <= w ? Math.min(w, m.width * 1.15) : Math.max(m.width * 0.68, w);
      svg.style.width = `${Math.round(width)}px`;
    }
    placePanel();
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(stage);
  fit();

  // ---- visibility -----------------------------------------------------------------------------------
  if (typeof IntersectionObserver === "function")
    new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) wake();
    }).observe(root);
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) wake();
  });

  // reduced motion: a still of a busy moment, ready to step or play
  if (reduced) {
    clock = model.horizon * 0.35;
    sim.runUntil(clock + lookahead());
    R.advance(clock);
    R.drain();
  }
  renderCrumbs();
  renderControls();
  fitWords();
  syncSwitches();
  renderInspector();
  if (document.fonts?.ready) document.fonts.ready.then(fitWords);
  draw();
  drawSlow();
  wake();

  const api = {
    play,
    pause,
    step,
    setSpeed,
    setLayer,
    open: (path) => setView(path),
    up: () => view && setView(levelOf(view)),
    select,
    follow: (id) => setFollow(id),
    inject,
    undo,
    restart,
    /** Turn a part's switch (a station or a choice) off or back on. */
    toggle,
    /** Set dial number i of a part to one of its options. */
    setDial: (path, i, index) => chooseOption(`dial:${path}#${i}`, index),
    /** Open a part's settings on the figure (a part with dials or servers that scale), or close them. */
    settings: (path) => (path ? (select(path), openPanel(path)) : closePanel()),
    /** Jump the clock (tests and captures): runs the model to t. */
    seek(t) {
      if (t < clock) restart(false);
      clock = t;
      sim.runUntil(clock + lookahead());
      R.advance(clock);
      R.drain();
      glides.clear();
      draw();
      drawSlow();
    },
    /** Fit the words again (after the page's fonts change). */
    refit: fitWords,
    state: () => ({ clock, view, selected, followed, playing, speed, layer, done: R.done, alive: R.alive.size, changes: changes.length, pace, basePace, median: R.quantile(0.5), settings: Object.fromEntries(settings), panel: panelFor }),
    get replay() {
      return R;
    },
  };
  root.dissect = api;
  return api;
}

/** Mount every figure on the page from its embedded data (what page.mjs writes). */
export function boot() {
  for (const el of document.querySelectorAll("script[data-dissect]")) {
    const data = JSON.parse(el.textContent);
    const root = document.getElementById(el.getAttribute("data-dissect"));
    if (root && !root.dissect) mount(root, data.model, data.options);
  }
}

