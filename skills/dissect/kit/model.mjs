// The process model: what a figure says its process IS. Everything the figure
// draws, moves and counts is read from this one object, so the picture cannot
// drift from the truth.
//
// A process has lanes (who or what does the work), parts (where work happens
// or where it is decided) and routes (how work moves between parts). Parts:
//
//   start    where work items (tokens) come from: `every` (inter-arrival time),
//            optional `first` (time of the first arrival, default 0), `count`
//            (stop after n) and `classes` ({ feature: 0.8, hotfix: 0.2 })
//   end      where they leave, with an optional `outcome` label
//   station  where work is done: `servers` (how many at once), `work` (how long
//            one item takes), optional `fail` (chance it fails), `patience`
//            (longest wait in the queue before giving up: outcome "timeout"),
//            `capacity` (queue size: arrivals beyond it are "rejected"), `scale`
//            (servers that follow the load: autoscaling), and `inside`: a whole
//            subprocess that IS its work (open it to see it)
//   choice   exclusive gateway (BPMN XOR): exactly one route out, picked by
//            probability `p` or by `when` ("ok", "fail", "timeout", "rejected",
//            "class:<name>", "else"), with `max` to cap how many times one item
//            takes a route (a retry loop)
//
// A chance (`p` on a route, `fail` on a station) can differ by kind of item:
// { bots: 0.6, people: 0.002 }, with `else` for the kinds it does not name.
// The reader can turn a station or a choice off (`switch`) and set a part's
// `dials` (options that change its numbers from the moment they are chosen).
//   split    parallel gateway (BPMN AND fork): one child item down every route;
//            with `fanout: true` the copies go on alone to their own ends (a
//            message to every subscriber) and no join follows
//   join     parallel join: waits for every child of the split, then goes on
//   timer    a wait: `wait` (a backoff, a cool-down, an approval delay)
//   store    a database, cache or file the stations `use`; tokens never enter it
//
// Every part sits on the floor plan: `lane` and `at: [column, row]`.

import { checkDuration } from "./dist.mjs";

export const KINDS = ["start", "end", "station", "choice", "split", "join", "timer", "store"];
export const OUTCOMES = ["ok", "fail", "timeout", "rejected"];

/** A chance for an item of kind `cls`: a number, or { <kind>: number, else: number }. */
export function chanceOf(v, cls) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return v[cls] ?? v.else ?? 0;
}
/** The largest chance any kind gets. */
export const chanceMax = (v) => (v == null ? 0 : typeof v === "number" ? v : Math.max(0, ...Object.values(v)));
const chanceOk = (v) => (typeof v === "number" ? v >= 0 && v <= 1 : v != null && typeof v === "object" && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === "number" && x >= 0 && x <= 1));

// autoscaling, unless the model says otherwise: aim at 60% busy, look again
// every fortieth of the horizon, take six looks to start a server, and wait as
// long after adding servers before removing any
export const SCALE = { target: 0.6, every: (horizon) => horizon / 40, boot: (every) => every * 6, cooldown: (every) => every * 6 };

// what a change, a switch or a dial may set, by kind of part
export const SETTABLE = {
  station: ["servers", "work", "fail", "patience", "capacity", "bypass", "scale"],
  choice: ["p", "take"],
  start: ["every", "classes", "paused"],
  timer: ["wait"],
};

/** Every kind of item the model's starts make, or its dials can make. */
export function kindsOf(model) {
  const out = [];
  const add = (c) => !out.includes(c) && out.push(c);
  for (const p of model.parts) {
    if (p.kind === "start") for (const c of Object.keys(p.classes || {})) add(c);
    for (const d of p.dials || []) for (const o of d.options || []) for (const c of Object.keys(o.set?.classes || {})) add(c);
  }
  return out;
}

/**
 * The changes a run starts with: every switch that starts off, and every dial
 * whose first option is not the model as written.
 */
export function initialChanges(model) {
  const out = [];
  (function walk(m) {
    for (const p of m.parts) {
      if (p.switch && p.switch.on === false) out.push(...switchChanges(m, p, false).map((c) => ({ ...c, t: 0 })));
      for (const d of p.dials || []) {
        const o = d.options?.[d.value ?? 0];
        if (o) out.push(...optionChanges(m, p, o).map((c) => ({ ...c, t: 0 })));
      }
      if (p.inside) walk(p.inside);
    }
  })(model);
  return out;
}

const pathIn = (m, id) => (m.path ? `${m.path}/${id}` : id);

/** What turning a part's switch off (or back on) changes. On is the model as written. */
export function switchChanges(m, p, on) {
  const off = p.switch?.off ?? (p.kind === "station" ? [{ set: { bypass: true } }] : [{ set: { take: (m.outs.get(p.id) || []).find((r) => r.bypass)?.id ?? null } }]);
  const list = off.map((c) => ({ part: pathIn(m, c.part ?? p.id), set: c.set }));
  return on ? list.map((c) => ({ part: c.part, set: restoreOf(m, c.part, Object.keys(c.set)) })) : list;
}

/** What an option sets, as changes (the part's own set, then its changes to other parts). */
export function optionChanges(m, p, o) {
  const list = [];
  if (o.set) list.push({ part: pathIn(m, p.id), set: o.set });
  for (const c of o.changes || []) list.push({ part: pathIn(m, c.part), set: c.set });
  return list;
}

/**
 * What choosing a dial's option changes: every field any of its options sets
 * goes back to the model as written, then the chosen option's own values.
 */
export function dialChanges(m, p, d, index) {
  const fields = new Map();
  for (const o of d.options) for (const c of optionChanges(m, p, o)) fields.set(c.part, new Set([...(fields.get(c.part) || []), ...Object.keys(c.set || {})]));
  const restore = [...fields].map(([part, f]) => ({ part, set: restoreOf(m, part, [...f]) }));
  return restore.concat(optionChanges(m, p, d.options[index]));
}

/** The model-as-written values of some fields of a part, as a change's set. */
export function restoreOf(m, path, fields) {
  const id = path.slice(path.lastIndexOf("/") + 1);
  const p = m.byId.get(id);
  const set = {};
  for (const f of fields) {
    if (f === "bypass") set.bypass = false;
    else if (f === "take") set.take = null;
    else if (f === "paused") set.paused = false;
    else if (f === "p") set.p = null;
    else if (f === "scale") set.scale = p.scale ?? false;
    else if (f === "capacity") set.capacity = p.capacity ?? Infinity;
    else if (f === "patience") set.patience = p.patience ?? null;
    else set[f] = p[f];
  }
  return set;
}

const ID = /^[a-z0-9][a-z0-9_.-]*$/i;

/** Fill defaults and build the indexes the simulator and layout use. Pure. */
export function normalize(def, path = "") {
  const lanes = (def.lanes && def.lanes.length ? def.lanes : [{ id: "main", label: "" }]).map((l) => ({ label: "", ...l }));
  const laneIds = new Set(lanes.map((l) => l.id));
  const parts = (def.parts || []).map((p) => {
    // `named`: the model gave it words of its own (the label defaults to the id)
    const part = { label: p.id, ...p, named: p.label != null, path: path ? `${path}/${p.id}` : p.id };
    if (!part.lane) part.lane = lanes[0].id;
    if (part.kind === "station") {
      // Infinity travels through JSON as "inf"
      const sv = part.servers;
      part.servers = sv === "inf" || sv === "Infinity" ? Infinity : (sv ?? (part.inside ? Infinity : 1));
      part.fail = part.fail ?? 0;
      // an inner process keeps the unit of the one that holds it
      if (part.inside) part.inside = normalize({ unit: def.unit, ...part.inside }, part.path);
    }
    if (part.kind === "start" && part.classes == null) part.classes = { item: 1 };
    return part;
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const routes = (def.routes || []).map((r, i) => ({
    id: r.id || `${r.from}>${r.to}`,
    index: i,
    latency: 0,
    ...r,
  }));
  const outs = new Map(parts.map((p) => [p.id, []]));
  const ins = new Map(parts.map((p) => [p.id, []]));
  for (const r of routes) {
    if (outs.has(r.from)) outs.get(r.from).push(r);
    if (ins.has(r.to)) ins.get(r.to).push(r);
  }
  return {
    id: def.id || "process",
    title: def.title || "",
    unit: def.unit || "",
    seed: def.seed ?? 1,
    horizon: def.horizon ?? 600,
    // how many real items one dot stands for (a dot can be a hundred requests)
    per: def.per ?? 1,
    path,
    lanes,
    laneIds,
    parts,
    byId,
    routes,
    outs,
    ins,
    raw: def,
  };
}

function reach(model, starts, next) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next(id)) stack.push(n);
  }
  return seen;
}

/**
 * Structural checks. Returns { errors, warnings }, each a list of sentences
 * naming the part or route at fault. A figure is not built while errors remain.
 */
export function validate(def, opts = {}) {
  const errors = [];
  const warnings = [];
  let kinds = [];
  const level = (m, where, inner) => {
    const at = (s) => (where ? `${where}: ${s}` : s);
    const seen = new Set();
    for (const p of m.parts) {
      if (!p.id || !ID.test(p.id)) errors.push(at(`part id "${p.id}" must be letters, digits, dots, dashes or underscores`));
      if (seen.has(p.id)) errors.push(at(`two parts are called "${p.id}"`));
      seen.add(p.id);
      if (!KINDS.includes(p.kind)) errors.push(at(`part "${p.id}" has kind "${p.kind}"; use one of ${KINDS.join(", ")}`));
      if (!m.laneIds.has(p.lane)) errors.push(at(`part "${p.id}" is in lane "${p.lane}", which is not declared`));
      if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every(Number.isFinite)) errors.push(at(`part "${p.id}" needs at: [column, row] on the floor plan`));
    }
    const routeIds = new Set();
    for (const r of m.routes) {
      if (!m.byId.has(r.from)) errors.push(at(`a route starts at "${r.from}", which is not a part`));
      if (!m.byId.has(r.to)) errors.push(at(`a route ends at "${r.to}", which is not a part`));
      if (r.from === r.to) errors.push(at(`route ${r.id} goes from "${r.from}" to itself; loop through a choice instead`));
      if (routeIds.has(r.id)) errors.push(at(`two routes are called "${r.id}"; give one an id`));
      routeIds.add(r.id);
      if (r.latency) {
        const e = checkDuration(r.latency);
        if (e) errors.push(at(`route ${r.id} latency: ${e}`));
      }
      if (r.p != null && !chanceOk(r.p)) errors.push(at(`route ${r.id} has p = ${JSON.stringify(r.p)}; a probability is between 0 and 1 (or one for each kind of item: { bots: 0.6, people: 0.002 })`));
      if (r.bypass && m.byId.get(r.from)?.kind !== "choice") errors.push(at(`route ${r.id} is a bypass, but only a route out of a choice can be (the way it sends everything when it is off)`));
      if (r.max != null && !(Number.isInteger(r.max) && r.max >= 1)) errors.push(at(`route ${r.id} has max = ${r.max}; use a whole number from 1`));
    }
    if (errors.length) return;

    const starts = m.parts.filter((p) => p.kind === "start");
    const ends = m.parts.filter((p) => p.kind === "end");
    if (starts.length === 0) errors.push(at("there is no start: work has to come from somewhere"));
    if (ends.length === 0) errors.push(at("there is no end: work has to leave somewhere"));
    if (inner && starts.length > 1) errors.push(at("a subprocess has exactly one start, its entry"));

    for (const p of m.parts) {
      const nIn = m.ins.get(p.id).length;
      const nOut = m.outs.get(p.id).length;
      const name = `${p.kind} "${p.id}"`;
      switch (p.kind) {
        case "start":
          if (nIn) errors.push(at(`${name} has routes coming in; a start only sends`));
          if (nOut !== 1) errors.push(at(`${name} needs exactly one route out (it has ${nOut})`));
          if (!inner) {
            if (p.every == null) errors.push(at(`${name} needs every: how often work arrives`));
            else {
              const e = checkDuration(p.every);
              if (e) errors.push(at(`${name} every: ${e}`));
            }
          } else if (p.every != null) errors.push(at(`${name} is a subprocess entry; it takes the item from its station, so drop every`));
          if (p.classes) {
            const sum = Object.values(p.classes).reduce((s, v) => s + v, 0);
            if (!(sum > 0)) errors.push(at(`${name} classes need positive weights`));
          }
          break;
        case "end":
          if (nOut) errors.push(at(`${name} has routes going out; an end only receives`));
          if (!nIn) errors.push(at(`${name} receives nothing`));
          break;
        case "station":
          if (!nIn) errors.push(at(`${name} receives nothing`));
          if (!nOut) errors.push(at(`${name} needs a route out`));
          if (nOut > 1 && m.outs.get(p.id).some((r) => !r.when)) errors.push(at(`${name} has ${nOut} routes out; put a choice after it, or give every route a when`));
          if (!p.inside) {
            if (p.work == null) errors.push(at(`${name} needs work: how long one item takes`));
            else {
              const e = checkDuration(p.work);
              if (e) errors.push(at(`${name} work: ${e}`));
            }
          } else if (p.work != null) warnings.push(at(`${name} has both work and inside; its time comes from inside, work is ignored`));
          if (!(p.servers >= 1)) errors.push(at(`${name} needs servers >= 1`));
          if (Number.isFinite(p.servers) && !Number.isInteger(p.servers)) errors.push(at(`${name} servers must be a whole number`));
          if (!chanceOk(p.fail)) errors.push(at(`${name} fail is a probability between 0 and 1 (or one for each kind of item: { bots: 0.6, people: 0.002 })`));
          if (p.scale != null && p.scale !== false) {
            const sc = p.scale;
            if (!Number.isFinite(p.servers)) errors.push(at(`${name} scales, so it needs a number of servers to start with`));
            if (!(Number.isInteger(sc.min) && sc.min >= 1)) errors.push(at(`${name} scale needs min: the fewest servers, a whole number from 1`));
            if (!(Number.isInteger(sc.max) && sc.max >= (sc.min ?? 1))) errors.push(at(`${name} scale needs max: the most servers, a whole number no smaller than min`));
            if (Number.isFinite(p.servers) && (p.servers < sc.min || p.servers > sc.max)) errors.push(at(`${name} starts with ${p.servers} servers, outside its scale (${sc.min} to ${sc.max})`));
            if (sc.target != null && !(sc.target > 0 && sc.target <= 1)) errors.push(at(`${name} scale target is the busy share it aims at, above 0 and at most 1`));
            for (const k of ["every", "boot", "cooldown"])
              if (sc[k] != null) {
                const e = checkDuration(sc[k]);
                if (e) errors.push(at(`${name} scale ${k}: ${e}`));
              }
          }
          if (p.patience != null) {
            const e = checkDuration(p.patience);
            if (e) errors.push(at(`${name} patience: ${e}`));
          }
          if (p.capacity != null && !(Number.isInteger(p.capacity) && p.capacity >= 0)) errors.push(at(`${name} capacity is a whole number of queue places`));
          for (const s of p.uses || []) {
            const st = m.byId.get(s);
            if (!st || st.kind !== "store") errors.push(at(`${name} uses "${s}", which is not a store`));
          }
          break;
        case "choice": {
          const rs = m.outs.get(p.id);
          if (!nIn) errors.push(at(`${name} receives nothing`));
          if (rs.length < 2) errors.push(at(`${name} needs at least two routes out`));
          const byP = rs.filter((r) => r.p != null);
          const byWhen = rs.filter((r) => r.when != null);
          if (byP.length && byWhen.length) errors.push(at(`${name} mixes p and when; decide by chance or by outcome, not both`));
          if (byP.length) {
            if (byP.length !== rs.length) errors.push(at(`${name}: give every route a p`));
            else if (rs.every((r) => typeof r.p === "number")) {
              const sum = byP.reduce((s, r) => s + r.p, 0);
              if (Math.abs(sum - 1) > 1e-9) errors.push(at(`${name}: the p of its routes add up to ${+sum.toFixed(6)}, not 1`));
            } else
              for (const k of kinds) {
                const sum = rs.reduce((s, r) => s + chanceOf(r.p, k), 0);
                if (Math.abs(sum - 1) > 1e-9) errors.push(at(`${name}: for ${k}, the p of its routes add up to ${+sum.toFixed(6)}, not 1`));
              }
          } else if (byWhen.length) {
            const elses = rs.filter((r) => r.when === "else" || r.when == null);
            if (elses.length > 1) errors.push(at(`${name} has more than one else route`));
            for (const r of rs) {
              if (r.when && r.when !== "else" && !OUTCOMES.includes(r.when) && !/^class:.+/.test(r.when)) errors.push(at(`route ${r.id}: when "${r.when}" is not an outcome (${OUTCOMES.join(", ")}), class:<name> or else`));
            }
            const covered = new Set(rs.map((r) => r.when));
            const capped = rs.filter((r) => r.max != null);
            if (!covered.has("else") && !rs.some((r) => r.when == null) && !covered.has("ok") && !rs.some((r) => /^class:/.test(r.when || ""))) warnings.push(at(`${name} has no route for "ok" and no else; an item that succeeded has nowhere to go`));
            for (const r of capped) {
              const sameWhen = rs.filter((x) => x.when === r.when && x !== r);
              if (!sameWhen.length && !covered.has("else")) errors.push(at(`route ${r.id} has max ${r.max}; add a second route with when "${r.when}" (or an else) for when the cap is used up`));
            }
          } else errors.push(at(`${name}: give its routes p (by chance) or when (by outcome)`));
          break;
        }
        case "split":
          if (!nIn) errors.push(at(`${name} receives nothing`));
          if (nOut < 2) errors.push(at(`${name} needs at least two routes out`));
          break;
        case "join":
          if (nIn < 2) errors.push(at(`${name} needs at least two routes in`));
          if (nOut !== 1) errors.push(at(`${name} needs exactly one route out`));
          break;
        case "timer": {
          if (!nIn) errors.push(at(`${name} receives nothing`));
          if (nOut !== 1) errors.push(at(`${name} needs exactly one route out`));
          const e = p.wait == null ? "needs wait: how long it holds an item" : checkDuration(p.wait);
          if (e) errors.push(at(`${name} ${e.startsWith("needs") ? e : "wait: " + e}`));
          break;
        }
        case "store":
          if (nIn || nOut) errors.push(at(`${name} has routes; items never travel into a store, stations use it`));
          break;
      }
      if (p.switch != null && p.switch !== false) {
        if (p.kind !== "station" && p.kind !== "choice") errors.push(at(`${name} has a switch; only a station or a choice can be turned off`));
        else if (p.switch !== true && typeof p.switch !== "object") errors.push(at(`${name}: switch is true, or { on, off }`));
        else if (p.kind === "choice" && !p.switch.off && m.outs.get(p.id).filter((r) => r.bypass).length !== 1) errors.push(at(`${name} has a switch: mark the one route it sends everything down when it is off with bypass: true`));
      }
      for (const d of p.dials || []) {
        if (!d || !Array.isArray(d.options) || d.options.length < 2) {
          errors.push(at(`${name}: a dial needs a label and at least two options`));
          continue;
        }
        const dial = `the dial "${d.label}" of ${name}`;
        if (!d.label) errors.push(at(`${name}: a dial needs a label`));
        const v = d.value ?? 0;
        if (!(Number.isInteger(v) && v >= 0 && v < d.options.length)) errors.push(at(`${dial} starts on option ${v}, which it does not have`));
        for (const o of d.options) {
          if (!o.label) errors.push(at(`${dial}: every option needs a label`));
          for (const c of [{ part: p.id, set: o.set }, ...(o.changes || [])]) {
            if (!c.set) continue;
            const q = m.byId.get(c.part);
            if (!q) {
              errors.push(at(`${dial} changes "${c.part}", which is not a part on its level`));
              continue;
            }
            const can = SETTABLE[q.kind] || [];
            for (const [k, val] of Object.entries(c.set)) {
              if (!can.includes(k)) errors.push(at(`${dial} sets ${k} on ${q.kind} "${q.id}", which can only have ${can.join(", ") || "nothing"} changed`));
              else if (["work", "every", "patience", "wait"].includes(k) && val != null) {
                const e = checkDuration(val);
                if (e) errors.push(at(`${dial}, option "${o.label}", ${k}: ${e}`));
              } else if (k === "fail" && !chanceOk(val)) errors.push(at(`${dial}, option "${o.label}": fail is a probability, or one for each kind of item`));
              else if (k === "take" && val != null && !m.outs.get(q.id).some((r) => r.id === val)) errors.push(at(`${dial}, option "${o.label}": "${q.id}" has no route "${val}" to take`));
              else if (k === "servers" && !(val === Infinity || (Number.isInteger(val) && val >= 0))) errors.push(at(`${dial}, option "${o.label}": servers is a whole number`));
              else if (k === "scale" && val !== false && (typeof val !== "object" || !q.scale)) errors.push(at(`${dial}, option "${o.label}": scale is false (no autoscaling) or changes to the scale "${q.id}" has`));
            }
          }
        }
      }
    }
    if (errors.length) return;

    const flow = m.parts.filter((p) => p.kind !== "store");
    const fromStarts = reach(m, starts.map((p) => p.id), (id) => m.outs.get(id).map((r) => r.to));
    for (const p of flow) if (!fromStarts.has(p.id)) errors.push(at(`${p.kind} "${p.id}" cannot be reached from a start`));
    const toEnds = reach(m, ends.map((p) => p.id), (id) => m.ins.get(id).map((r) => r.from));
    for (const p of flow) if (!toEnds.has(p.id)) errors.push(at(`${p.kind} "${p.id}" cannot reach an end: items would pile up there`));

    for (const s of m.parts.filter((p) => p.kind === "split" && p.fanout)) {
      if (inner) errors.push(at(`split "${s.id}" fans out inside a step's own process: its copies would leave the step one by one. Fan out on the level above`));
      const joins = reach(m, m.outs.get(s.id).map((r) => r.to), (id) => m.outs.get(id).map((r) => r.to));
      for (const id of joins) if (m.byId.get(id).kind === "join") errors.push(at(`join "${id}" comes after the fan-out "${s.id}"; fan-out copies go on alone, so nothing would ever join them`));
    }
    for (const s of m.parts.filter((p) => p.kind === "split" && !p.fanout)) {
      const firstJoins = m.outs.get(s.id).map((r) => {
        const found = new Set();
        const seenB = new Set();
        const stack = [r.to];
        while (stack.length) {
          const id = stack.pop();
          if (seenB.has(id)) continue;
          seenB.add(id);
          const q = m.byId.get(id);
          if (q.kind === "join") {
            found.add(id);
            continue;
          }
          for (const o of m.outs.get(id)) stack.push(o.to);
        }
        return found;
      });
      const common = [...firstJoins[0]].filter((j) => firstJoins.every((f) => f.has(j)));
      if (!common.length) errors.push(at(`split "${s.id}": its branches never meet at one join, so the parallel work is never put back together`));
      else {
        const j = common[0];
        const nIn = m.ins.get(j).length;
        const nOut = m.outs.get(s.id).length;
        if (nIn !== nOut) errors.push(at(`split "${s.id}" opens ${nOut} branches but join "${j}" waits for ${nIn}`));
      }
    }

    for (const p of m.parts.filter((x) => x.kind === "station" && x.inside)) level(p.inside, where ? `${where} > ${p.id}` : p.id, true);
    // A station that can fail should have a choice downstream that looks at the outcome.
    for (const p of m.parts.filter((x) => x.kind === "station" && (chanceMax(x.fail) > 0 || x.patience != null || x.capacity != null))) {
      const choices = [];
      const seenF = new Set();
      const stack = m.outs.get(p.id).map((r) => r.to);
      while (stack.length) {
        const id = stack.pop();
        if (seenF.has(id)) continue;
        seenF.add(id);
        const q = m.byId.get(id);
        if (q.kind === "choice") {
          choices.push(q);
          continue;
        }
        if (q.kind === "end") continue;
        for (const o of m.outs.get(id)) stack.push(o.to);
      }
      // the station's own routes can sort by outcome (an implicit choice), or a choice further on
      const own = m.outs.get(p.id);
      const routed = (w) => own.some((r) => r.when === w || r.when === "else") || choices.some((c) => m.outs.get(c.id).some((r) => r.when === w || r.when === "else"));
      if (chanceMax(p.fail) > 0 && !routed("fail")) warnings.push(at(`station "${p.id}" fails ${typeof p.fail === "number" ? "" : "up to "}${Math.round(chanceMax(p.fail) * 100)}% of the time, but no choice after it routes "fail"; failed items carry on as if nothing happened`));
      if (p.patience != null && !routed("timeout")) warnings.push(at(`station "${p.id}" has patience, but no choice after it routes "timeout"`));
      if (p.capacity != null && !routed("rejected")) warnings.push(at(`station "${p.id}" has a capacity, but no choice after it routes "rejected"`));
    }
  };
  const model = def.byId ? def : normalize(def);
  kinds = kindsOf(model);
  if (!(Number.isInteger(model.per) && model.per >= 1)) errors.push(`per is how many real items one dot stands for: a whole number from 1`);
  level(model, "", false);
  if (opts.throws && errors.length) throw new Error(`dissect: the model has problems:\n- ${errors.join("\n- ")}`);
  return { errors, warnings, model };
}
