// The simulator: a discrete-event model of the process. It is the single
// source of every number a figure shows and of every move a token makes.
//
// It runs incrementally (`runUntil(t)`), so a live page can simulate a few
// seconds ahead of what it shows. It is deterministic: one seed, one run, and
// every part draws from its own stream, so a change at one station (an outage
// injected at t = 40) leaves every other draw where it was and the log before
// t = 40 byte-identical.
//
// The log is the contract with the renderer. Each record is
//   { t, k, tok, at, ... }  with k one of
//   born  move  queue  start  finish  renege  reject  decide  split  joinwait
//   join  wait  enter  exit  done  change  pass  scale  vus
// `at` is a part path ("deploy", "test/unit"); `route` is "<level path>::<route id>".
// A station with no limit records no `queue`: its items start the moment they arrive.
// `pass` is an item going straight through a station that is switched off;
// `scale` is a station that scales: { servers, booting } from that moment;
// `vus` is a closed start's number of virtual users from that moment ({ n }).
// A `born` record with `from` is an item a station emitted as another left it.

import { normalize, validate, OUTCOMES, SCALE, chanceOf, initialChanges } from "./model.mjs";
import { sampler, meanOf } from "./dist.mjs";

/** A station's work: one duration for every item, or one per kind of item ({ cpu: "logn 5 6", else: 0.2 }). */
export function workSampler(spec) {
  if (spec != null && typeof spec === "object") {
    const by = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, sampler(v)]));
    return (cls, rng) => (by[cls] ?? by.else ?? (() => 0))(rng);
  }
  const s = sampler(spec);
  return (cls, rng) => s(rng);
}
/** The mean time of a work spec, over its kinds when it has several. */
export function meanWork(spec) {
  if (spec != null && typeof spec === "object") {
    const v = Object.values(spec).map(meanOf);
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  }
  return meanOf(spec);
}
import { streams } from "./rng.mjs";

class Heap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  peek() {
    return this.a[0];
  }
  push(e) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
const less = (x, y) => x.t < y.t || (x.t === y.t && x.seq < y.seq);

const WORST = ["ok", "rejected", "timeout", "fail"];
const worst = (a, b) => (WORST.indexOf(a) >= WORST.indexOf(b) ? a : b);

/** Index every part of every level by its path. */
function indexLevels(root) {
  const parts = new Map();
  const levels = new Map();
  const walk = (m) => {
    levels.set(m.path, m);
    for (const p of m.parts) {
      parts.set(p.path, { part: p, level: m });
      if (p.inside) walk(p.inside);
    }
  };
  walk(root);
  return { parts, levels };
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Build a simulator. Options:
 *   seed      overrides the model's seed
 *   horizon   last time a start may create an item (default model.horizon)
 *   changes   [{ t, part: "path", set: { servers, work, fail, patience, wait, capacity, every, p, classes,
 *                                         bypass, take, paused, scale } },
 *              { t, route: "<level>::<id>", set: { latency } }]
 *             A change at t <= 0 is where the run starts from. The model's own
 *             switches and dials set theirs first.
 *   warmup    time excluded from the steady-state statistics (default 0)
 */
export function createSim(def, opts = {}) {
  const { errors, model } = validate(def.byId ? def : normalize(def));
  if (errors.length) throw new Error(`dissect: the model has problems:\n- ${errors.join("\n- ")}`);
  const seed = opts.seed ?? model.seed;
  const horizon = opts.horizon ?? model.horizon;
  const warmup = opts.warmup ?? 0;
  const stream = streams(seed);
  const { parts, levels } = indexLevels(model);

  // live, changeable parameters (a change replaces them from its time on)
  const params = new Map();
  for (const [path, { part }] of parts) {
    params.set(path, {
      servers: part.servers,
      work: part.work != null ? workSampler(part.work) : null,
      fail: part.fail ?? 0,
      patience: part.patience != null ? sampler(part.patience) : null,
      every: part.every != null ? sampler(part.every) : null,
      wait: part.wait != null ? sampler(part.wait) : null,
      capacity: part.capacity ?? Infinity,
      odds: null, // a choice's p per route id, once a change sets them
      classes: null, // a start's class mix, once a change sets it
      workSpec: part.work ?? null,
      bypass: false, // a station switched off: items go straight through
      take: null, // a choice switched off: everything takes this route
      paused: false, // a start that sends nothing
      scale: null, // a station's autoscaling policy, while it has one
      vus: part.vus ?? null, // a closed start's stages: [[duration, virtual users], ...]
      think: part.think != null ? sampler(part.think) : () => 0, // a virtual user's pause between iterations
    });
  }
  const routeParams = new Map();
  for (const [lp, level] of levels) for (const r of level.routes) routeParams.set(`${lp}::${r.id}`, { latency: r.latency ? sampler(r.latency) : () => 0 });

  const heap = new Heap();
  let seq = 0;
  const log = [];
  const tokens = new Map();
  let now = 0;
  let nextId = 1;
  const arrivalVersion = new Map();

  // statistics
  const st = {
    born: 0,
    done: 0,
    outcomes: {},
    inSystem: 0,
    wipArea: 0,
    wipAt: 0,
    lead: [],
    leadAfterWarmup: [],
    doneAfterWarmup: 0,
    stations: new Map(),
    routes: new Map(),
    choices: new Map(),
    kinds: new Map(), // per kind of item: { done, outcomes, ends, lead }
    ends: {},
  };
  for (const [path, { part }] of parts) {
    if (part.kind === "station")
      st.stations.set(path, {
        arrivals: 0,
        starts: 0,
        finishes: 0,
        fails: 0,
        reneges: 0,
        rejects: 0,
        busy: 0,
        busyArea: 0,
        capArea: 0,
        queueArea: 0,
        maxQueue: 0,
        at: 0,
        waits: [],
        works: [],
      });
    if (part.kind === "choice") st.choices.set(path, {});
  }
  const stationState = new Map();
  for (const [path, { part }] of parts) if (part.kind === "station") stationState.set(path, { queue: [], slots: [] });
  const joinState = new Map();

  const schedule = (t, type, data) => heap.push({ t, seq: seq++, type, ...data });
  const record = (r) => log.push(r);

  const touchWip = (t) => {
    st.wipArea += st.inSystem * (t - st.wipAt);
    st.wipAt = t;
  };
  const touchStation = (path, t) => {
    const s = st.stations.get(path);
    const q = stationState.get(path).queue.length;
    const dt = t - s.at;
    s.busyArea += s.busy * dt;
    s.queueArea += q * dt;
    s.capArea += params.get(path).servers * dt;
    s.at = t;
  };

  // ---- arrivals --------------------------------------------------------
  const startPaths = [...parts].filter(([, v]) => v.part.kind === "start" && !v.level.path).map(([p]) => p);
  for (const path of startPaths) {
    arrivalVersion.set(path, 0);
    const { part } = parts.get(path);
    // a closed start (virtual users) is set going once the run's starting point is known
    if (part.vus) continue;
    // the first item arrives at `first` (default 0): a figure opens with work already moving
    schedule(Number(part.first ?? 0), "arrival", { at: path, v: 0 });
  }

  function pickClass(part, path) {
    const entries = Object.entries(params.get(path).classes || part.classes || { item: 1 });
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let u = stream(`class:${path}`)() * total;
    for (const [name, w] of entries) {
      u -= w;
      if (u < 0) return name;
    }
    return entries[entries.length - 1][0];
  }

  // ---- movement ----------------------------------------------------------
  function depart(tok, level, route, t) {
    const key = `${level.path}::${route.id}`;
    const lat = routeParams.get(key).latency(stream(`lat:${key}`));
    const toPath = level.path ? `${level.path}/${route.to}` : route.to;
    const fromPath = level.path ? `${level.path}/${route.from}` : route.from;
    record({ t, k: "move", tok: tok.id, route: key, from: fromPath, at: toPath, t1: t + lat });
    const rs = st.routes.get(key) || 0;
    st.routes.set(key, rs + 1);
    schedule(t + lat, "arrive", { tok: tok.id, at: toPath });
  }

  function leaveVia(tok, path, t) {
    const { part, level } = parts.get(path);
    const all = level.outs.get(part.id);
    const outs = all.filter((r) => !r.emit);
    if (outs.length === 1) depart(tok, level, outs[0], t);
    // a station with several routes out, each with a when: an implicit choice
    else choose(tok, path, t, true);
    emitAll(tok, path, t);
  }
  /** What a station or a choice sends as each item leaves it: a new item of another kind down each emitting route. */
  function emitAll(tok, path, t) {
    const { part, level } = parts.get(path);
    for (const r of level.outs.get(part.id)) if (r.emit) emit(tok, path, level, r, t);
  }
  function emit(from, path, level, route, t) {
    const tok = makeToken(route.emit, t, t);
    touchWip(t);
    st.inSystem += 1;
    st.born += 1;
    record({ t, k: "born", tok: tok.id, at: path, cls: tok.cls, from: from.id });
    depart(tok, level, route, t);
  }

  function choose(tok, path, t, implicit = false) {
    const { part, level } = parts.get(path);
    const outs = level.outs.get(part.id).filter((r) => !r.emit);
    let route = null;
    // a choice switched off sends everything one way
    const take = params.get(path)?.take;
    if (take != null) route = outs.find((r) => r.id === take) || null;
    if (!route && outs.some((r) => r.p != null)) {
      const odds = params.get(path).odds;
      let u = stream(`choose:${path}`)();
      for (const r of outs) {
        u -= odds ? (odds.get(r.id) ?? 0) : chanceOf(r.p, tok.cls);
        if (u < 0) {
          route = r;
          break;
        }
      }
      route = route || outs[outs.length - 1];
    } else if (!route) {
      for (const r of outs) {
        const w = r.when;
        // late:<time> is an item that has taken that long or more since it started (a deadline it missed)
        const matches = w == null || w === "else" || w === tok.outcome || (w.startsWith("class:") && w.slice(6) === tok.cls) || (w.startsWith("late:") && t - tok.born >= Number(w.slice(5)));
        if (!matches) continue;
        const used = tok.attempts.get(`${level.path}::${r.id}`) || 0;
        if (r.max != null && used >= r.max) continue;
        route = r;
        break;
      }
    }
    if (!route) throw new Error(`dissect: no route out of ${path} for an item with outcome "${tok.outcome}" (class ${tok.cls})`);
    const key = `${level.path}::${route.id}`;
    tok.attempts.set(key, (tok.attempts.get(key) || 0) + 1);
    if (!implicit) {
      record({ t, k: "decide", tok: tok.id, at: path, route: key });
      const c = st.choices.get(path);
      c[route.id] = (c[route.id] || 0) + 1;
    }
    depart(tok, level, route, t);
  }

  // ---- stations ------------------------------------------------------------
  function tryStart(path, t) {
    const S = stationState.get(path);
    const prm = params.get(path);
    const s = st.stations.get(path);
    while (S.queue.length && s.busy < prm.servers) {
      const tokId = S.queue.shift();
      const tok = tokens.get(tokId);
      if (tok.renege) tok.renege.cancelled = true;
      let slot = S.slots.indexOf(null);
      if (slot < 0) {
        slot = S.slots.length;
        S.slots.push(null);
      }
      touchStation(path, t);
      S.slots[slot] = tokId;
      s.busy += 1;
      s.starts += 1;
      s.waits.push(t - tok.queuedAt);
      const { part } = parts.get(path);
      if (part.inside) {
        record({ t, k: "start", tok: tokId, at: path, server: slot });
        enterInside(tok, part, t, slot);
      } else {
        const d = prm.work(tok.cls, stream(`work:${path}`));
        s.works.push(d);
        record({ t, k: "start", tok: tokId, at: path, server: slot, t1: t + d });
        schedule(t + d, "finish", { tok: tokId, at: path, slot });
      }
    }
  }

  function finishAt(path, tokId, slot, t, outcome) {
    const S = stationState.get(path);
    const s = st.stations.get(path);
    const tok = tokens.get(tokId);
    touchStation(path, t);
    S.slots[slot] = null;
    s.busy -= 1;
    s.finishes += 1;
    if (outcome === "fail") s.fails += 1;
    tok.outcome = outcome;
    record({ t, k: "finish", tok: tokId, at: path, server: slot, outcome });
    tryStart(path, t);
    leaveVia(tok, path, t);
  }

  function enterInside(tok, part, t, slot) {
    const inner = part.inside;
    const entry = inner.parts.find((p) => p.kind === "start");
    tok.stack.push({ station: part.path, slot });
    record({ t, k: "enter", tok: tok.id, at: entry.path, station: part.path });
    depart(tok, inner, inner.outs.get(entry.id)[0], t);
  }

  // ---- event handlers --------------------------------------------------------
  function arrive(tok, path, t) {
    const { part } = parts.get(path);
    switch (part.kind) {
      case "station": {
        const S = stationState.get(path);
        const s = st.stations.get(path);
        const prm = params.get(path);
        if (prm.bypass) {
          // switched off: no work, no queue, no failing
          record({ t, k: "pass", tok: tok.id, at: path });
          leaveVia(tok, path, t);
          return;
        }
        s.arrivals += 1;
        if (S.queue.length >= prm.capacity && s.busy >= prm.servers) {
          s.rejects += 1;
          tok.outcome = "rejected";
          record({ t, k: "reject", tok: tok.id, at: path });
          leaveVia(tok, path, t);
          return;
        }
        touchStation(path, t);
        tok.queuedAt = t;
        S.queue.push(tok.id);
        s.maxQueue = Math.max(s.maxQueue, S.queue.length);
        // where there is no limit an item starts at once: its start says it arrived
        if (Number.isFinite(prm.servers)) record({ t, k: "queue", tok: tok.id, at: path });
        if (prm.patience) {
          const limit = prm.patience(stream(`patience:${path}`));
          tok.renege = { at: path, cancelled: false };
          schedule(t + limit, "renege", { tok: tok.id, at: path, ref: tok.renege });
        }
        tryStart(path, t);
        return;
      }
      case "choice":
        choose(tok, path, t);
        return emitAll(tok, path, t);
      case "split": {
        const { level } = parts.get(path);
        const outs = level.outs.get(part.id);
        if (part.fanout) {
          // a fan-out: one item per branch, each going on alone to its own end (a
          // message delivered to every subscriber); the original is replaced by its copies
          const kids = outs.map((r, i) => {
            const child = makeToken(tok.cls, tok.born, t, { parent: tok.id, branch: i });
            child.attempts = new Map(tok.attempts);
            return child;
          });
          touchWip(t);
          st.inSystem += kids.length - 1;
          tok.forked = "fanout";
          record({ t, k: "split", tok: tok.id, at: path, children: kids.map((c) => c.id), fanout: true });
          kids.forEach((c, i) => depart(c, level, outs[i], t));
          return;
        }
        const gid = `${tok.id}@${path}#${tok.splits = (tok.splits || 0) + 1}`;
        const kids = outs.map((r, i) => {
          const child = makeToken(tok.cls, tok.born, t, { parent: tok.id, group: gid, branch: i });
          child.attempts = new Map(tok.attempts);
          child.stack = tok.stack.map((f) => ({ ...f }));
          return child;
        });
        joinState.set(gid, { parent: tok.id, need: kids.length, got: [], outcome: "ok" });
        tok.forked = gid;
        record({ t, k: "split", tok: tok.id, at: path, children: kids.map((c) => c.id) });
        kids.forEach((c, i) => depart(c, level, outs[i], t));
        return;
      }
      case "join": {
        const J = joinState.get(tok.group);
        if (!J) throw new Error(`dissect: item ${tok.id} reached join ${path} without a split`);
        J.got.push(tok.id);
        J.outcome = worst(J.outcome, tok.outcome);
        record({ t, k: "joinwait", tok: tok.id, at: path, n: J.got.length, need: J.need });
        if (J.got.length === J.need) {
          joinState.delete(tok.group);
          const parent = tokens.get(J.parent);
          parent.forked = null;
          parent.outcome = J.outcome;
          for (const id of J.got) tokens.get(id).merged = true;
          record({ t, k: "join", tok: parent.id, at: path, children: J.got.slice(), outcome: J.outcome });
          leaveVia(parent, path, t);
        }
        return;
      }
      case "timer": {
        const d = params.get(path).wait(stream(`wait:${path}`));
        record({ t, k: "wait", tok: tok.id, at: path, t1: t + d });
        schedule(t + d, "waited", { tok: tok.id, at: path });
        return;
      }
      case "end": {
        const outcome = part.outcome || tok.outcome;
        if (tok.stack.length) {
          // leaving a subprocess: back to the station that holds it
          const frame = tok.stack.pop();
          record({ t, k: "exit", tok: tok.id, at: path, station: frame.station, outcome });
          // only the routable outcomes travel up; a labelled end ("approved") counts as ok
          finishAt(frame.station, tok.id, frame.slot, t, OUTCOMES.includes(outcome) ? outcome : "ok");
          return;
        }
        touchWip(t);
        st.inSystem -= 1;
        st.done += 1;
        st.outcomes[outcome] = (st.outcomes[outcome] || 0) + 1;
        const lead = t - tok.born;
        st.lead.push(lead);
        st.ends[path] = (st.ends[path] || 0) + 1;
        if (!st.kinds.has(tok.cls)) st.kinds.set(tok.cls, { done: 0, outcomes: {}, ends: {}, lead: [] });
        const K = st.kinds.get(tok.cls);
        K.done += 1;
        K.outcomes[outcome] = (K.outcomes[outcome] || 0) + 1;
        K.ends[path] = (K.ends[path] || 0) + 1;
        K.lead.push(lead);
        if (tok.born >= warmup) {
          st.leadAfterWarmup.push(lead);
          st.doneAfterWarmup += 1;
        }
        tok.done = t;
        tok.outcome = outcome;
        record({ t, k: "done", tok: tok.id, at: path, outcome });
        if (tok.vuOf) iterationDone(tok.vuOf, t);
        return;
      }
      default:
        throw new Error(`dissect: an item reached ${part.kind} "${path}"`);
    }
  }

  function makeToken(cls, born, t, extra = {}) {
    const id = extra.parent ? `${extra.parent}.${extra.branch + 1}` : String(nextId++);
    const tok = { id, cls, born, outcome: "ok", attempts: new Map(), stack: [], group: extra.group || null, parent: extra.parent || null };
    tokens.set(id, tok);
    return tok;
  }

  // a start's arrivals begin again from t (a new rate, or let go after a pause);
  // the ones already on their way are called off
  function restartArrivals(path, t) {
    const v = (arrivalVersion.get(path) || 0) + 1;
    arrivalVersion.set(path, v);
    const prm = params.get(path);
    if (!prm.paused && prm.every) schedule(t + prm.every(stream(`arrive:${path}`)), "arrival", { at: path, v });
  }

  /** Apply a change at t. A change at the very start (initial) sets where the run starts from. */
  function applyChange(c, t, initial = false) {
    if (c.part) {
      const prm = params.get(c.part);
      if (!prm) throw new Error(`dissect: a change names part "${c.part}", which does not exist`);
      const set = c.set || {};
      if (set.servers != null) {
        if (st.stations.has(c.part)) touchStation(c.part, t);
        prm.servers = set.servers;
      }
      if (set.work != null) {
        prm.work = workSampler(set.work);
        prm.workSpec = set.work;
      }
      if (set.fail != null) prm.fail = set.fail;
      if ("patience" in set) prm.patience = set.patience != null ? sampler(set.patience) : null;
      if (set.wait != null) prm.wait = sampler(set.wait);
      if (set.capacity != null) prm.capacity = set.capacity;
      if (set.classes != null) prm.classes = { ...set.classes };
      if ("p" in set) {
        if (set.p == null) prm.odds = null;
        else {
          // new odds for a choice, by route id; they are scaled to add up to 1
          const total = Object.values(set.p).reduce((a, b) => a + b, 0);
          if (!(total > 0)) throw new Error(`dissect: a change gives choice "${c.part}" odds that add up to ${total}`);
          prm.odds = new Map(Object.entries(set.p).map(([k, v]) => [k, v / total]));
        }
      }
      if ("take" in set) prm.take = set.take ?? null;
      if ("bypass" in set) prm.bypass = Boolean(set.bypass);
      if ("scale" in set) setScale(c.part, set.scale, t);
      if (set.every != null) prm.every = sampler(set.every);
      if ("paused" in set) prm.paused = Boolean(set.paused);
      if (set.think != null) prm.think = sampler(set.think);
      if (set.vus != null) {
        prm.vus = set.vus;
        if (!initial && crowds.has(c.part)) rampFrom(c.part, t);
      }
      if (!initial && (set.every != null || "paused" in set)) restartArrivals(c.part, t);
      record({ t, k: "change", at: c.part, set: c.set });
      if (scaling.has(c.part) && set.servers != null) noteScale(c.part, t);
      if (st.stations.has(c.part)) tryStart(c.part, t);
    } else if (c.route) {
      const rp = routeParams.get(c.route);
      if (!rp) throw new Error(`dissect: a change names route "${c.route}", which does not exist`);
      if (c.set?.latency != null) rp.latency = sampler(c.set.latency);
      record({ t, k: "change", route: c.route, set: c.set });
    }
  }
  // ---- autoscaling ---------------------------------------------------------------
  // A station with `scale` looks at its load every `every`: the work that
  // arrived over the last look, in servers' worth, over the busy share it aims
  // at. It starts servers when it wants more (each ready after `boot`), and
  // stops some when it wants fewer, once `cooldown` has passed since it last
  // added any. The model's servers are what it starts with.
  const scaling = new Map();
  const policyOf = (base, set) => {
    const pol = { ...base, ...set };
    if (set.every != null) pol.every = meanOf(set.every);
    if (set.cooldown != null) pol.cooldown = meanOf(set.cooldown);
    if (set.boot != null) pol.boot = sampler(set.boot);
    return pol;
  };
  for (const [path, { part }] of parts) {
    if (part.kind !== "station" || !part.scale) continue;
    const every = meanOf(part.scale.every ?? SCALE.every(horizon));
    const base = { target: SCALE.target, min: part.scale.min, max: part.scale.max, every, boot: sampler(part.scale.boot ?? SCALE.boot(every)), cooldown: meanOf(part.scale.cooldown ?? SCALE.cooldown(every)) };
    params.get(path).scale = base;
    scaling.set(path, { base, booting: 0, v: 0, lastOut: -Infinity, arrivals0: 0, t0: 0 });
    schedule(every, "scale", { at: path });
  }
  function noteScale(path, t) {
    record({ t, k: "scale", at: path, servers: params.get(path).servers, booting: scaling.get(path).booting });
  }
  function setScale(path, val, t) {
    const S = scaling.get(path);
    if (!S) return;
    const prm = params.get(path);
    const callOff = () => {
      S.v += 1;
      S.booting = 0;
    };
    if (val === false || val == null) {
      // no autoscaling: the servers running stay, no more start
      prm.scale = null;
      callOff();
    } else {
      prm.scale = policyOf(S.base, val);
      const n = Math.min(prm.scale.max, Math.max(prm.scale.min, prm.servers));
      if (n !== prm.servers) {
        touchStation(path, t);
        prm.servers = n;
      }
      // servers still starting come, if the new policy has room for them
      if (prm.servers + S.booting > prm.scale.max) callOff();
    }
    noteScale(path, t);
  }
  function look(path, t) {
    const S = scaling.get(path);
    const prm = params.get(path);
    const s = st.stations.get(path);
    const arrived = s.arrivals - S.arrivals0;
    const span = t - S.t0;
    S.arrivals0 = s.arrivals;
    S.t0 = t;
    const pol = prm.scale;
    if (pol && span > 0 && prm.workSpec != null) {
      const need = (arrived * meanWork(prm.workSpec)) / span;
      const want = Math.min(pol.max, Math.max(pol.min, Math.ceil(need / pol.target - 1e-9)));
      const have = prm.servers + S.booting;
      if (want > have) {
        for (let i = 0; i < want - have; i++) schedule(t + pol.boot(stream(`boot:${path}`)), "ready", { at: path, v: S.v });
        S.booting = want - prm.servers;
        S.lastOut = t;
        noteScale(path, t);
      } else if (want < prm.servers && S.booting === 0 && t - S.lastOut >= pol.cooldown) {
        touchStation(path, t);
        prm.servers = want;
        noteScale(path, t);
      }
    }
    const every = pol?.every ?? S.base.every;
    if (t + every <= horizon) schedule(t + every, "scale", { at: path });
  }

  // ---- closed starts: virtual users -------------------------------------------------
  // A start with `vus` is a closed model, the way k6 runs: its stages ramp the
  // number of virtual users ([[30, 20], [60, 20], [20, 0]] is up to 20 in 30 s,
  // 20 for a minute, down to none in 20 s). A virtual user starts an iteration
  // (one item) at once, and when that item ends it pauses (`think`) and starts the
  // next; when the stages want fewer users than are running, the next one to end
  // its iteration stops. Nothing new starts after the horizon.
  const crowds = new Map();
  const targetAt = (stages, t) => {
    let at = 0;
    let n = 0;
    for (const [d, to] of stages) {
      if (t <= at + d) return d > 0 ? n + ((to - n) * (t - at)) / d : to;
      at += d;
      n = to;
    }
    return n;
  };
  const wanted = (path, t) => Math.floor(targetAt(params.get(path).vus || [], t) + 1e-9);
  function noteVus(path, t) {
    record({ t, k: "vus", at: path, n: crowds.get(path).active });
  }
  function beginIteration(path, t) {
    const { part, level } = parts.get(path);
    const tok = makeToken(pickClass(part, path), t, t);
    tok.vuOf = path;
    touchWip(t);
    st.inSystem += 1;
    st.born += 1;
    record({ t, k: "born", tok: tok.id, at: path, cls: tok.cls });
    depart(tok, level, level.outs.get(part.id)[0], t);
  }
  // the moments the stages want one more user than now, from t on
  function rampFrom(path, t) {
    const C = crowds.get(path);
    C.v += 1;
    while (C.active < wanted(path, t) && t <= horizon) {
      C.active += 1;
      noteVus(path, t);
      beginIteration(path, t);
    }
    let at = 0;
    let n = 0;
    for (const [d, to] of params.get(path).vus || []) {
      if (to > n)
        for (let k = Math.floor(n) + 1; k <= to; k++) {
          const tk = at + (d * (k - n)) / (to - n);
          if (tk > t && tk <= horizon) schedule(tk, "vu", { at: path, v: C.v });
        }
      at += d;
      n = to;
    }
  }
  function iterationDone(path, t) {
    const C = crowds.get(path);
    if (t > horizon || C.active > wanted(path, t)) {
      C.active -= 1;
      noteVus(path, t);
      return;
    }
    schedule(t + params.get(path).think(stream(`think:${path}`)), "iterate", { at: path });
  }

  // where the run starts from: the model's own switches and dials, then the changes at t <= 0
  for (const c of initialChanges(model)) applyChange(c, 0, true);
  for (const c of opts.changes || []) if (c.t <= 0) applyChange(c, 0, true);
  for (const path of startPaths) {
    if (!params.get(path).vus) continue;
    crowds.set(path, { active: 0, v: 0 });
    rampFrom(path, 0);
  }
  const madeByStart = new Map();
  for (const c of opts.changes || []) if (c.t > 0) schedule(c.t, "change", { change: c });

  function step(e) {
    now = e.t;
    switch (e.type) {
      case "arrival": {
        if (e.v !== arrivalVersion.get(e.at)) return;
        if (e.t > horizon) return;
        // a paused start sends nothing; its next item comes after it is let go again
        if (params.get(e.at).paused) return;
        const { part } = parts.get(e.at);
        const made = (madeByStart.get(e.at) || 0) + 1;
        madeByStart.set(e.at, made);
        if (part.count != null && made > part.count) return;
        const tok = makeToken(pickClass(part, e.at), e.t, e.t);
        touchWip(e.t);
        st.inSystem += 1;
        st.born += 1;
        record({ t: e.t, k: "born", tok: tok.id, at: e.at, cls: tok.cls });
        const { level } = parts.get(e.at);
        depart(tok, level, level.outs.get(part.id)[0], e.t);
        if (part.count == null || made < part.count) schedule(e.t + params.get(e.at).every(stream(`arrive:${e.at}`)), "arrival", { at: e.at, v: e.v });
        return;
      }
      case "arrive":
        return arrive(tokens.get(e.tok), e.at, e.t);
      case "finish": {
        const tok = tokens.get(e.tok);
        const prm = params.get(e.at);
        const pf = chanceOf(prm.fail, tok.cls);
        const failed = pf > 0 && stream(`fail:${e.at}`)() < pf;
        return finishAt(e.at, tok.id, e.slot, e.t, failed ? "fail" : "ok");
      }
      case "renege": {
        if (e.ref.cancelled) return;
        const S = stationState.get(e.at);
        const i = S.queue.indexOf(e.tok);
        if (i < 0) return;
        touchStation(e.at, e.t);
        S.queue.splice(i, 1);
        const s = st.stations.get(e.at);
        s.reneges += 1;
        const tok = tokens.get(e.tok);
        tok.outcome = "timeout";
        record({ t: e.t, k: "renege", tok: e.tok, at: e.at });
        return leaveVia(tok, e.at, e.t);
      }
      case "waited":
        return leaveVia(tokens.get(e.tok), e.at, e.t);
      case "change":
        return applyChange(e.change, e.t);
      case "scale":
        return look(e.at, e.t);
      case "vu": {
        // the stages want one more virtual user now
        const C = crowds.get(e.at);
        if (e.v !== C.v || C.active >= wanted(e.at, e.t)) return;
        C.active += 1;
        noteVus(e.at, e.t);
        return beginIteration(e.at, e.t);
      }
      case "iterate": {
        // after its pause: the stages may have come down in the meantime
        const C = crowds.get(e.at);
        if (e.t > horizon || C.active > wanted(e.at, e.t)) {
          C.active -= 1;
          return noteVus(e.at, e.t);
        }
        return beginIteration(e.at, e.t);
      }
      case "ready": {
        const S = scaling.get(e.at);
        // a policy changed since this server was asked for: it never comes
        if (e.v !== S.v) return;
        S.booting -= 1;
        touchStation(e.at, e.t);
        params.get(e.at).servers += 1;
        noteScale(e.at, e.t);
        return tryStart(e.at, e.t);
      }
    }
  }

  const sim = {
    model,
    parts,
    levels,
    log,
    tokens,
    seed,
    horizon,
    get now() {
      return now;
    },
    /** Process every event up to and including time t. */
    runUntil(t) {
      while (heap.size && heap.peek().t <= t) step(heap.pop());
      now = Math.max(now, t);
      return sim;
    },
    /** Run until nothing is left to happen (after the horizon, items drain). */
    runToEnd(limit = Infinity) {
      while (heap.size && heap.peek().t <= limit) step(heap.pop());
      return sim;
    },
    /**
     * Metrics of the run so far. It describes the past only: the accumulators
     * stand at the time the run has reached, so stats() is taken at that time
     * (run to the moment you want with runUntil first).
     */
    stats() {
      return statsOf(sim, st, now, warmup, params);
    },
    _st: st,
  };
  return sim;
}

function statsOf(sim, st, t, warmup, params) {
  const span = Math.max(1e-9, t);
  const wip = (st.wipArea + st.inSystem * (t - st.wipAt)) / span;
  const lead = st.lead.slice().sort((a, b) => a - b);
  const leadW = st.leadAfterWarmup.slice().sort((a, b) => a - b);
  const stations = {};
  for (const [path, s] of st.stations) {
    const servers = params.get(path).servers;
    const dt = t - s.at;
    const busyArea = s.busyArea + s.busy * dt;
    const capArea = s.capArea + servers * dt;
    const q = s.queueArea;
    const waits = s.waits.slice().sort((a, b) => a - b);
    stations[path] = {
      arrivals: s.arrivals,
      started: s.starts,
      finished: s.finishes,
      failed: s.fails,
      timedOut: s.reneges,
      rejected: s.rejects,
      busy: s.busy,
      utilization: Number.isFinite(capArea) && capArea > 0 ? busyArea / capArea : null,
      meanQueue: q / span,
      maxQueue: s.maxQueue,
      meanWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
      p95Wait: quantile(waits, 0.95),
      meanWork: s.works.length ? s.works.reduce((a, b) => a + b, 0) / s.works.length : null,
    };
  }
  const throughput = st.done / span;
  const meanLead = lead.length ? lead.reduce((a, b) => a + b, 0) / lead.length : 0;
  const steadySpan = Math.max(1e-9, t - warmup);
  return {
    t,
    born: st.born,
    done: st.done,
    inSystem: st.inSystem,
    outcomes: { ...st.outcomes },
    throughput,
    wip,
    meanLead,
    p50Lead: quantile(lead, 0.5),
    p95Lead: quantile(lead, 0.95),
    p99Lead: quantile(lead, 0.99),
    steady: {
      throughput: st.doneAfterWarmup / steadySpan,
      meanLead: leadW.length ? leadW.reduce((a, b) => a + b, 0) / leadW.length : 0,
    },
    stations,
    routes: Object.fromEntries(st.routes),
    choices: Object.fromEntries([...st.choices].map(([k, v]) => [k, { ...v }])),
    // where items ended (top-level ends), and the same per kind of item
    ends: { ...st.ends },
    kinds: Object.fromEntries(
      [...st.kinds].map(([k, K]) => {
        const l = K.lead.slice().sort((a, b) => a - b);
        return [k, { done: K.done, outcomes: { ...K.outcomes }, ends: { ...K.ends }, p50Lead: quantile(l, 0.5), p95Lead: quantile(l, 0.95) }];
      }),
    ),
    servers: Object.fromEntries([...params].filter(([p]) => st.stations.has(p)).map(([p, v]) => [p, v.servers])),
  };
}

/** Re-run a model with changes, e.g. an outage injected by the reader at t. */
export function simulate(def, opts = {}) {
  const sim = createSim(def, opts);
  if (opts.until != null) sim.runUntil(opts.until);
  else sim.runToEnd();
  return sim;
}
