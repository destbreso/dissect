// Replay: reads the simulator's log in time order and keeps the state a figure
// draws at any moment: where every item is, who waits in which queue, which bay
// is busy and how far along, what each gateway decided last, what each counter
// says. The live page and the still drawing both read from it, so a still and
// a frame of the live figure at the same time are the same picture.

export const levelOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const routeLevel = (key) => key.slice(0, key.indexOf("::"));

/**
 * stations: Map of station path -> servers (Infinity for no limit), from the model.
 * The log is read through `log`, which may grow while the replay runs (the
 * simulator works a little ahead of what is shown).
 */
export class Replay {
  constructor(log, { stations = new Map(), ends = [] } = {}) {
    this.log = log;
    this.i = 0;
    this.t = 0;
    this.tokens = new Map();
    this.alive = new Set();
    this.st = new Map();
    for (const [path, servers] of stations) this.st.set(path, { servers, booting: 0, passed: 0, queue: [], bays: [], busy: 0, busyArea: 0, capArea: 0, at: 0, arrivals: 0, started: 0, finished: 0, failed: 0, timedOut: 0, rejected: 0, waitSum: 0, waitN: 0, workSum: 0, workN: 0, inside: 0 });
    this.joins = new Map();
    this.timers = new Map();
    this.choices = new Map();
    this.ends = new Map(ends.map((p) => [p, 0]));
    this.passes = new Map();
    this.born = 0;
    this.bornAt = new Map();
    this.done = 0;
    this.leads = [];
    this.leadSum = 0;
    this.outcomes = {};
    this.changes = [];
    this.events = [];
    // every item that has left, in time order, for the numbers of a recent window
    this.finished = [];
    this.recentFrom = 0;
  }

  /** The items that left in the last `window` before t: [{ t, cls, outcome, at }]. */
  recent(window, t = this.t) {
    const f = this.finished;
    while (this.recentFrom < f.length && f[this.recentFrom].t <= t - window) this.recentFrom += 1;
    while (this.recentFrom > 0 && f[this.recentFrom - 1].t > t - window) this.recentFrom -= 1;
    const out = [];
    for (let i = this.recentFrom; i < f.length && f[i].t <= t; i++) out.push(f[i]);
    return out;
  }

  get next() {
    return this.i < this.log.length ? this.log[this.i].t : Infinity;
  }

  /** Apply every record up to and including time t. */
  advance(t) {
    const log = this.log;
    while (this.i < log.length && log[this.i].t <= t) this.apply(log[this.i++]);
    this.t = Math.max(this.t, t);
    return this;
  }

  touch(s, t) {
    const dt = t - s.at;
    if (dt > 0) {
      s.busyArea += s.busy * dt;
      if (Number.isFinite(s.servers)) s.capArea += s.servers * dt;
      s.at = t;
    }
  }

  /** Share of capacity used so far (null for no limit). */
  utilization(path, t = this.t) {
    const s = this.st.get(path);
    if (!s || !Number.isFinite(s.servers)) return null;
    const dt = Math.max(0, t - s.at);
    const cap = s.capArea + s.servers * dt;
    return cap > 0 ? (s.busyArea + s.busy * dt) / cap : 0;
  }

  token(id, from) {
    let tok = this.tokens.get(id);
    if (!tok) {
      const parent = from ? this.tokens.get(from) : null;
      tok = { id, cls: parent?.cls ?? "item", born: parent?.born ?? this.t, mode: "new", at: null, outcome: "ok", stack: parent ? parent.stack.slice() : [], parent: from || null, visits: 0 };
      this.tokens.set(id, tok);
      this.alive.add(id);
    }
    return tok;
  }

  apply(r) {
    const tok = r.tok != null ? this.tokens.get(r.tok) : null;
    switch (r.k) {
      case "born": {
        const t = this.token(r.tok);
        t.cls = r.cls;
        t.born = r.t;
        t.mode = "at";
        t.at = r.at;
        this.born += 1;
        this.bornAt.set(r.at, (this.bornAt.get(r.at) || 0) + 1);
        break;
      }
      case "move": {
        const t = tok || this.token(r.tok);
        if (t.mode === "wait") this.timers.get(t.at)?.delete(t.id);
        t.mode = "move";
        t.route = r.route;
        t.from = r.from;
        t.at = r.at;
        t.t0 = r.t;
        t.t1 = r.t1;
        t.lastRoute = r.route;
        this.passes.set(r.route, (this.passes.get(r.route) || 0) + 1);
        this.events.push({ k: "move", tok: t.id, route: r.route, t: r.t, t1: r.t1 });
        break;
      }
      case "queue": {
        const s = this.st.get(r.at);
        s.arrivals += 1;
        s.queue.push(tok.id);
        tok.mode = "queue";
        tok.at = r.at;
        tok.queuedAt = r.t;
        break;
      }
      case "reject": {
        const s = this.st.get(r.at);
        s.arrivals += 1;
        s.rejected += 1;
        tok.mode = "at";
        tok.at = r.at;
        tok.outcome = "rejected";
        this.events.push({ k: "reject", tok: tok.id, at: r.at });
        break;
      }
      case "start": {
        const s = this.st.get(r.at);
        const qi = s.queue.indexOf(tok.id);
        // a start with no queue record before it is an item that arrived and started at once
        if (qi >= 0) s.queue.splice(qi, 1);
        else s.arrivals += 1;
        this.touch(s, r.t);
        s.busy += 1;
        s.started += 1;
        s.waitSum += qi >= 0 ? r.t - (tok.queuedAt ?? r.t) : 0;
        s.waitN += 1;
        s.bays[r.server] = { tok: tok.id, t0: r.t, t1: r.t1 };
        tok.mode = r.t1 == null ? "inside" : "serve";
        tok.at = r.at;
        tok.server = r.server;
        tok.t0 = r.t;
        tok.t1 = r.t1;
        tok.outcome = "ok";
        if (r.t1 != null) {
          s.workSum += r.t1 - r.t;
          s.workN += 1;
        } else s.inside += 1;
        this.events.push({ k: "start", tok: tok.id, at: r.at });
        break;
      }
      case "finish": {
        const s = this.st.get(r.at);
        this.touch(s, r.t);
        s.busy -= 1;
        s.finished += 1;
        if (r.outcome === "fail") s.failed += 1;
        const bay = s.bays[r.server];
        if (bay && bay.t1 == null) {
          s.inside -= 1;
          s.workSum += r.t - bay.t0;
          s.workN += 1;
        }
        s.bays[r.server] = null;
        tok.mode = "at";
        tok.at = r.at;
        tok.outcome = r.outcome;
        tok.visits += 1;
        this.events.push({ k: "finish", tok: tok.id, at: r.at, outcome: r.outcome });
        break;
      }
      case "renege": {
        const s = this.st.get(r.at);
        const qi = s.queue.indexOf(tok.id);
        if (qi >= 0) s.queue.splice(qi, 1);
        s.timedOut += 1;
        tok.mode = "at";
        tok.at = r.at;
        tok.outcome = "timeout";
        this.events.push({ k: "renege", tok: tok.id, at: r.at });
        break;
      }
      case "decide": {
        let c = this.choices.get(r.at);
        if (!c) this.choices.set(r.at, (c = { last: null, counts: {} }));
        c.last = r.route;
        c.counts[r.route] = (c.counts[r.route] || 0) + 1;
        tok.mode = "at";
        tok.at = r.at;
        this.events.push({ k: "decide", tok: tok.id, at: r.at, route: r.route });
        break;
      }
      case "split": {
        tok.mode = "forked";
        tok.at = r.at;
        for (const c of r.children) {
          const child = this.token(c, tok.id);
          child.mode = "at";
          child.at = r.at;
          child.cls = tok.cls;
          child.born = tok.born;
          child.stack = tok.stack.slice();
        }
        this.alive.delete(tok.id);
        break;
      }
      case "joinwait": {
        let j = this.joins.get(r.at);
        if (!j) this.joins.set(r.at, (j = { waiting: new Set() }));
        j.waiting.add(tok.id);
        tok.mode = "joinwait";
        tok.at = r.at;
        break;
      }
      case "join": {
        const j = this.joins.get(r.at);
        for (const c of r.children) {
          j?.waiting.delete(c);
          const child = this.tokens.get(c);
          if (child) child.mode = "merged";
          this.alive.delete(c);
        }
        tok.mode = "at";
        tok.at = r.at;
        tok.outcome = r.outcome ?? tok.outcome;
        this.alive.add(tok.id);
        this.events.push({ k: "join", tok: tok.id, at: r.at, children: r.children });
        break;
      }
      case "wait": {
        let set = this.timers.get(r.at);
        if (!set) this.timers.set(r.at, (set = new Set()));
        set.add(tok.id);
        tok.mode = "wait";
        tok.at = r.at;
        tok.t0 = r.t;
        tok.t1 = r.t1;
        break;
      }
      case "enter":
        tok.stack.push(r.station);
        tok.mode = "at";
        tok.at = r.at;
        this.events.push({ k: "enter", tok: tok.id, station: r.station });
        break;
      case "exit":
        // an inner end counts the items that leave the step through it
        this.ends.set(r.at, (this.ends.get(r.at) || 0) + 1);
        tok.stack.pop();
        tok.mode = "at";
        tok.at = r.station;
        tok.outcome = r.outcome;
        this.events.push({ k: "exit", tok: tok.id, station: r.station, outcome: r.outcome });
        break;
      case "done": {
        tok.mode = "done";
        tok.at = r.at;
        tok.outcome = r.outcome;
        tok.doneAt = r.t;
        this.alive.delete(tok.id);
        this.ends.set(r.at, (this.ends.get(r.at) || 0) + 1);
        this.finished.push({ t: r.t, cls: tok.cls, outcome: r.outcome, at: r.at, lead: r.t - tok.born });
        this.done += 1;
        this.outcomes[r.outcome] = (this.outcomes[r.outcome] || 0) + 1;
        const lead = r.t - tok.born;
        this.leadSum += lead;
        // keep the lead times sorted for the median and the p95
        let lo = 0;
        let hi = this.leads.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (this.leads[mid] < lead) lo = mid + 1;
          else hi = mid;
        }
        this.leads.splice(lo, 0, lead);
        this.events.push({ k: "done", tok: tok.id, at: r.at, outcome: r.outcome, lead });
        break;
      }
      case "pass": {
        // through a station that is switched off: nothing happens there
        const s = this.st.get(r.at);
        if (s) s.passed += 1;
        tok.mode = "at";
        tok.at = r.at;
        this.events.push({ k: "pass", tok: tok.id, at: r.at });
        break;
      }
      case "scale": {
        const s = this.st.get(r.at);
        if (s) {
          this.touch(s, r.t);
          s.servers = r.servers;
          s.booting = r.booting;
        }
        this.events.push({ k: "scale", at: r.at, servers: r.servers, booting: r.booting });
        break;
      }
      case "change": {
        this.changes.push(r);
        if (r.at && r.set?.servers != null) {
          const s = this.st.get(r.at);
          if (s) {
            this.touch(s, r.t);
            s.servers = r.set.servers;
          }
        }
        this.events.push({ k: "change", at: r.at, route: r.route, set: r.set });
        break;
      }
    }
  }

  /** Take the events applied since the last call (the page animates from them). */
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  quantile(q) {
    const a = this.leads;
    if (!a.length) return NaN;
    const pos = (a.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  /** The level an item is on right now ("" for the top), or null when it is not drawn. */
  levelOfToken(tok) {
    if (tok.mode === "move") return routeLevel(tok.route);
    if (tok.mode === "forked" || tok.mode === "merged" || tok.mode === "new" || !tok.at) return null;
    return levelOf(tok.at);
  }
}

// ---- where an item is drawn ------------------------------------------------------------
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** A point along a route at distance s. */
function at(points, s) {
  let left = s;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (left <= l || i === points.length - 1) {
      const u = l ? Math.min(1, Math.max(0, left / l)) : 0;
      return [ax + (bx - ax) * u, ay + (by - ay) * u];
    }
    left -= l;
  }
  return points[points.length - 1];
}

/**
 * Where to draw an item on the sheet of level `view` at time t:
 * { x, y, mini } or null when it is not on that sheet. `mini` means it is
 * inside a station of this sheet and is drawn small in its window. Items in
 * service are docked in a bay (drawn by the bay, not as a dot): { dock }.
 */
export function placeOf(R, tok, metas, view, t) {
  const level = R.levelOfToken(tok);
  if (level == null) return null;
  const meta = metas[view];
  if (!meta) return null;
  if (level === view) return placeOnSheet(R, tok, meta, t);
  // deeper: inside a station drawn on this sheet
  const prefix = view ? `${view}/` : "";
  if (!level.startsWith(prefix) && view !== "") return null;
  const rest = level.slice(prefix.length);
  const first = rest.split("/")[0];
  const station = prefix + first;
  const mini = meta.minis[station];
  if (!mini) return null;
  const inner = rest.includes("/") ? null : level;
  if (inner === null) {
    // two levels down: show it at the inner station that holds it
    const id = rest.split("/")[1];
    const p = mini[id];
    return p ? { x: p[0], y: p[1], mini: true } : null;
  }
  const idOf = (path) => path.slice(path.lastIndexOf("/") + 1);
  if (tok.mode === "move") {
    const a = mini[idOf(tok.from)];
    const b = mini[idOf(tok.at)];
    if (!a || !b) return null;
    const u = tok.t1 > tok.t0 ? ease((t - tok.t0) / (tok.t1 - tok.t0)) : 1;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, mini: true };
  }
  const p = mini[idOf(tok.at)];
  return p ? { x: p[0], y: p[1], mini: true } : null;
}

function placeOnSheet(R, tok, meta, t) {
  switch (tok.mode) {
    case "move": {
      const rt = meta.routes[tok.route];
      if (!rt) return null;
      const u = tok.t1 > tok.t0 ? (t - tok.t0) / (tok.t1 - tok.t0) : 1;
      const [x, y] = at(rt.points, rt.length * ease(u));
      return { x, y };
    }
    case "queue": {
      const q = meta.queues[tok.at];
      const s = R.st.get(tok.at);
      const i = s ? s.queue.indexOf(tok.id) : -1;
      if (!q || i < 0) {
        const p = meta.parts[tok.at];
        return p ? { x: p.x - p.w / 2 - 12, y: p.y } : null;
      }
      if (i >= q.slots.length) return { x: q.slots[q.slots.length - 1][0], y: q.slots[q.slots.length - 1][1], hidden: true };
      return { x: q.slots[i][0], y: q.slots[i][1] };
    }
    case "serve":
    case "inside": {
      const st = meta.stations[tok.at];
      if (st && st.bays[tok.server]) return { dock: tok.at, bay: tok.server };
      const p = meta.parts[tok.at];
      return p ? { dock: tok.at, x: p.x, y: p.y, rack: true } : null;
    }
    case "wait": {
      const tm = meta.timers[tok.at];
      if (!tm) return null;
      const u = tok.t1 > tok.t0 ? Math.min(1, (t - tok.t0) / (tok.t1 - tok.t0)) : 1;
      const a = -Math.PI / 2 + u * Math.PI * 2;
      return { x: tm.x + Math.cos(a) * (tm.r + 5), y: tm.y + Math.sin(a) * (tm.r + 5) };
    }
    case "joinwait": {
      const rt = meta.routes[tok.lastRoute];
      if (!rt) return null;
      const [x, y] = at(rt.points, Math.max(0, rt.length - 12));
      return { x, y };
    }
    case "done": {
      // it fades where its route meets the end, clear of the end's counter
      const rt = meta.routes[tok.lastRoute];
      if (rt) {
        const [x, y] = at(rt.points, Math.max(0, rt.length - 9));
        return { x, y, done: true };
      }
      const e = meta.ends[tok.at];
      return e ? { x: e.x, y: e.y, done: true } : null;
    }
    default: {
      const p = meta.parts[tok.at];
      return p ? { x: p.x, y: p.y } : null;
    }
  }
}
