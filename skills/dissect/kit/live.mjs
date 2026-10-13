// The live figure. The simulator runs a few seconds ahead of the clock the
// reader sees; the replay turns its log into the state of every part; this
// module draws that state on the pre-rendered sheets and lets the reader open
// steps, follow one item, and try what-ifs (an outage, one more reviewer). A
// what-if re-runs the model with the change from the current moment on: the
// past stays exactly as it was, because every part draws from its own stream.
//
// Browser only. Build pages with page.mjs, which inlines this module.

import { createSim } from "./sim.mjs";
import { normalize } from "./model.mjs";
import { Replay, placeOf, levelOf } from "./replay.mjs";
import { formatDuration, short, describe, scaleSpec } from "./dist.mjs";
import { along } from "./geom.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SVGNS = "http://www.w3.org/2000/svg";
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const GLIDE_PX_S = 520;
const IDLE_MS = 7000;
const pct = (v) => (v == null || !Number.isFinite(v) ? "-" : `${Math.round(v * 100)}%`);

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
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const classNames = [];
  for (const p of model.parts) if (p.kind === "start") for (const c of Object.keys(p.classes || { item: 1 })) if (!classNames.includes(c)) classNames.push(c);
  const classIndex = (c) => Math.max(0, classNames.indexOf(c)) % 5;
  const noun = model.raw.item || "item";

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
    glides.clear();
    if (words) announce(words);
    renderInspector();
    renderControls();
  }

  function undo() {
    if (!changes.length) return;
    changes = [];
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
    changes = [];
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

  // ---- levels -----------------------------------------------------------------------------
  let heightTimer = 0;
  function setView(path, { focus = false, from = null } = {}) {
    if (!sheets.has(path) || path === view) return;
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
    }
  }

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
        if (st?.bays[p.bay]) p = { x: st.bays[p.bay].x0 + Math.min(4.2, st.bays[p.bay].w / 2), y: st.bays[p.bay].y };
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
      const r = p.mini ? 2.3 : docked ? 3.4 : 4.6;
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
          if (per.done) per.done.textContent = `✓${okN}`;
          if (per.fails) per.fails.textContent = bad ? `  ✗${bad}` : "";
          fitCount(per.count);
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
        if (per.count) per.count.textContent = String(R.ends.get(path) || 0);
      } else if (p.kind === "choice" && per.needle) {
        const c = R.choices.get(path);
        const a = c ? metas[view].gates[path]?.needle[c.last] : null;
        if (a != null) per.needle.style.transform = `rotate(${a}deg)`;
      }
    }
    const p50 = R.quantile(0.5);
    const zoom = basePace / pace;
    readout.textContent = `${fmt(clock)} in · ${R.done} done · ${R.alive.size} in flight${R.done ? ` · median ${fmt(p50)}` : ""}${zoom > 1.5 ? ` · time ×1/${Math.round(zoom)}` : ""}`;
    refreshInspector();
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

  /** Set a station's counters smaller when they outgrow the room its work leaves them. */
  function fitCount(el) {
    const room = Number(el.dataset.room);
    if (!room || !el.getComputedTextLength) return;
    el.style.fontSize = "";
    let sz = 9.5;
    while (el.getComputedTextLength() > room && sz > 7) {
      sz -= 0.5;
      el.style.fontSize = `${sz}px`;
    }
  }

  /** Fit every word that has a fixed room (names, specs, lane labels) to the reader's font, and draw every tag to its words. */
  function fitWords() {
    for (const el of root.querySelectorAll("svg text[data-fit]")) fitInto(el, el.dataset.full, Number(el.dataset.fit), Number(el.dataset.size), Number(el.dataset.min), true);
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

  function stationWords(p) {
    if (p.inside) return `A process of its own (${p.inside.parts.filter((q) => q.kind === "station").length} steps). Click it to go inside.`;
    const cap = Number.isFinite(p.servers) ? (p.servers === 1 ? "One item at a time" : `${p.servers} items at a time`) : "No limit on how many at once";
    const extra = [];
    if (p.fail) extra.push(`${Math.round(p.fail * 100)}% ${p.failLabel || "fail"}`);
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
    if (p.kind === "station" && Number.isFinite(p.servers)) {
      const cur = R.st.get(p.path)?.servers ?? p.servers;
      if (cur >= 4) {
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
    if (p.kind === "start" && p.every != null && !levelOf(p.path)) {
      acts.push(["50% more work", () => inject({ part: p.path, set: { every: scaleSpec(base.every, 1 / 1.5) } }, "Work now arrives 50% more often.")]);
      acts.push(["Half the work", () => inject({ part: p.path, set: { every: scaleSpec(base.every, 2) } }, "Work now arrives half as often.")]);
      // a burst: three times the work for a while, then back to normal
      const span = options.burst ?? Math.max(1e-6, model.horizon / 10);
      acts.push([`A burst (${fmt(span)})`, () => inject([{ part: p.path, set: { every: scaleSpec(base.every, 1 / 3) } }, { part: p.path, set: { every: base.every }, t: clock + span }], `Three times the work for ${fmt(span)}.`)]);
      // with several kinds of work: half of one kind stops arriving (the rest arrive as before)
      const mix = Object.entries(p.classes || {});
      if (mix.length > 1) {
        const total = mix.reduce((a, [, w]) => a + w, 0);
        for (const [c, w] of mix) {
          const kept = total - w / 2;
          acts.push([`Half the ${c}`, () => inject({ part: p.path, set: { classes: { ...p.classes, [c]: w / 2 }, every: scaleSpec(base.every, total / kept) } }, `Half the ${c} no longer arrives.`)]);
        }
      }
    }
    if (p.kind === "choice") {
      // decisions by chance: shift the odds of the rarer way
      const lv = levels.get(levelOf(p.path));
      const outs = lv.outs.get(p.id);
      if (outs.every((r) => r.p != null)) {
        const last = [...changes].reverse().find((c) => c.part === p.path && c.set?.p);
        const total = last ? Object.values(last.set.p).reduce((a, b) => a + b, 0) : 1;
        const cur = new Map(outs.map((r) => [r.id, last ? (last.set.p[r.id] ?? 0) / total : r.p]));
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
      html += `<div class="dx-kind">${esc(kindName[p.kind] || p.kind)}</div><h3>${esc(p.label)}</h3>`;
      if (p.about) html += `<p>${esc(p.about)}</p>`;
      if (p.kind === "station") {
        html += `<p>${esc(stationWords(p))}</p><dl>`;
        html += `<dt>waiting now</dt>${val(() => String(R.st.get(selected)?.queue.length ?? 0))}`;
        html += `<dt>in work now</dt>${val(() => String(R.st.get(selected)?.busy ?? 0))}`;
        html += `<dt>done</dt>${val(() => String(R.st.get(selected)?.finished ?? 0))}`;
        if (Number.isFinite(p.servers)) html += `<dt>busy</dt>${val(() => pct(R.utilization(selected, clock)))}`;
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
        html += `</dl>`;
      } else if (p.kind === "choice") {
        const lv = levels.get(levelOf(selected));
        const outs = lv.outs.get(p.id);
        html += `<p>${esc(outs.some((r) => r.p != null) ? "Decides by chance:" : "Decides by how the item did:")}</p><dl>`;
        for (const r of outs) {
          const key = `${lv.path}::${r.id}`;
          const to = lv.byId.get(r.to);
          const last = [...changes].reverse().find((c) => c.part === selected && c.set?.p);
          const pNow = last ? (last.set.p[r.id] ?? 0) / Object.values(last.set.p).reduce((a, b) => a + b, 0) : r.p;
          const rule = r.p != null ? `${Math.round(pNow * 100)}%` : r.when === "else" || r.when == null ? "otherwise" : r.when.startsWith("class:") ? r.when.slice(6) : `if ${r.when}`;
          html += `<dt>${esc(rule)}${r.max ? ` (at most ${r.max}×)` : ""} → ${esc(to.label)}</dt>${val(() => {
            const c = R.choices.get(selected);
            const total = c ? Object.values(c.counts).reduce((a, b) => a + b, 0) : 0;
            return total ? `${pct((c.counts[key] || 0) / total)} so far` : "-";
          })}`;
        }
        html += `</dl>`;
      } else if (p.kind === "start" && p.every != null) {
        html += `<p>New work arrives every ${esc(describe(p.every, unit))}${p.count ? `, ${p.count} items in all` : ""}.</p><dl><dt>arrived</dt>${val(() => String(R.born))}</dl>`;
      } else if (p.kind === "end") {
        html += `<dl><dt>arrived here</dt>${val(() => String(R.ends.get(selected) || 0))}</dl>`;
      } else if (p.kind === "timer") {
        html += `<p>Holds each item ${esc(describe(p.wait, unit))}.</p><dl><dt>waiting now</dt>${val(() => String(R.timers.get(selected)?.size ?? 0))}</dl>`;
      } else if (p.kind === "join") {
        html += `<p>An item goes on only when every branch of its split has arrived. It is as late as its slowest branch.</p>`;
      } else if (p.kind === "split") {
        html += `<p>Each item becomes one item per branch, all at once.</p>`;
      }
      acts = actionsFor(p);
    } else {
      const holder = view ? parts.get(view) : null;
      html += `<div class="dx-kind">${view ? "Inside" : "The process"}</div><h3>${esc(holder ? holder.label : model.title || "Process")}</h3>`;
      const about = holder ? holder.about : model.raw.about;
      if (about) html += `<p>${esc(about)}</p>`;
      if (holder) {
        // this level's own numbers: the station that holds it
        const S = () => R.st.get(view);
        html += `<dl><dt>done</dt>${val(() => String(S().finished))}<dt>inside now</dt>${val(() => String(S().busy))}<dt>average time inside</dt>${val(() => (S().workN ? fmt(S().workSum / S().workN) : "-"))}`;
        if (Number.isFinite(holder.servers)) html += `<dt>waiting to get in</dt>${val(() => String(S().queue.length))}`;
        html += `</dl>`;
      } else html += `<dl><dt>done</dt>${val(() => String(R.done))}<dt>in flight</dt>${val(() => String(R.alive.size))}<dt>median time</dt>${val(() => (R.done ? fmt(R.quantile(0.5)) : "-"))}<dt>slowest 5%</dt>${val(() => (R.done >= 5 ? `over ${fmt(R.quantile(0.95))}` : "-"))}</dl>`;
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
  }

  function bottleneckWords(within = "") {
    const b = bottleneck(within);
    if (!b) return within ? "Nothing has had to wait in here yet." : "Watch the queues: where items wait is where the time goes.";
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
      } else select(path);
      return;
    }
    select(null);
  });
  stage.addEventListener("focusin", (e) => {
    const g = e.target.closest?.(".dx-part");
    if (g) select(g.getAttribute("data-path"));
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.closest?.("button") && (e.key === " " || e.key === "Enter")) return;
    touch();
    const g = e.target.closest?.(".dx-part");
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.key === "Enter" && g) {
      e.preventDefault();
      if (g.getAttribute("data-open") === "1") setView(g.getAttribute("data-path"), { focus: true });
      else select(g.getAttribute("data-path"));
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
  renderInspector();
  fitWords();
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
    state: () => ({ clock, view, selected, followed, playing, speed, layer, done: R.done, alive: R.alive.size, changes: changes.length, pace, basePace, median: R.quantile(0.5) }),
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

