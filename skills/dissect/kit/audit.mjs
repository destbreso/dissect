// The critic, in code. A figure ships when its audit passes. It checks three
// things a reader would catch:
//   the model    what the validator says (errors stop the build)
//   the drawing  parts that overlap, a route through a part or over words,
//                routes run on top of each other, tags that cover things,
//                names cut short, levels too wide to read on a laptop
//   the run      queues that never settle, routes no item ever takes, items
//                stuck at the end, and the claims the prose makes about the
//                numbers (`claims` in the model), on several seeds
// Node or browser; auditOrExit is the --audit hook for build scripts.

import { validate } from "./model.mjs";
import { layout } from "./layout.mjs";
import { createSim, simulate } from "./sim.mjs";
import { segmentsOf, segHitsRect, overlapLength, crosses, rectOf, rectsOverlap } from "./geom.mjs";
import { fitText, specOf } from "./render.mjs";

const WIDE = 1180;

function levelsOf(model) {
  const out = [];
  (function walk(m) {
    out.push(m);
    for (const p of m.parts) if (p.inside) walk(p.inside);
  })(model);
  return out;
}

const where = (lv) => (lv.path ? `inside ${lv.path}` : "top level");

/** Drawing checks for one level. */
export function auditLayout(lv, L) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const boxes = Object.values(L.parts);
  const at = where(lv);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (rectsOverlap(rectOf(boxes[i]), rectOf(boxes[j]), 6)) errors.push(`${at}: parts "${boxes[i].id}" and "${boxes[j].id}" overlap; move one to another cell (at)`);
  for (const rt of L.routes) {
    const segs = segmentsOf(rt.points);
    for (const q of boxes) {
      if (q.id === rt.from || q.id === rt.to) continue;
      if (segs.some((s) => segHitsRect(s, rectOf(q, 2)))) errors.push(`${at}: route ${rt.id} runs through "${q.id}"; move a part so the route has a clear way`);
    }
    for (const t of L.texts) {
      if (t.id === rt.from || t.id === rt.to) continue;
      if (segs.some((s) => segHitsRect(s, t))) warnings.push(`${at}: route ${rt.id} runs over the words of "${t.id}"`);
    }
  }
  for (const t of L.texts) for (const q of boxes) if (q.id !== t.id && rectsOverlap(t, rectOf(q), 1)) warnings.push(`${at}: the words of "${t.id}" sit on "${q.id}"; move one of them`);
  let crossings = 0;
  for (let i = 0; i < L.routes.length; i++)
    for (let j = i + 1; j < L.routes.length; j++) {
      const a = L.routes[i];
      const b = L.routes[j];
      const shared = (a.from === b.from && a.exit === b.exit) || (a.to === b.to && a.entry === b.entry);
      for (const s of segmentsOf(a.points))
        for (const t of segmentsOf(b.points)) {
          if (!shared && overlapLength(s, t, 3) > 8) warnings.push(`${at}: routes ${a.id} and ${b.id} run on top of each other; a reader cannot tell them apart`);
          else if (crosses(s, t)) crossings += 1;
        }
    }
  if (crossings > 3) notes.push(`${at}: routes cross ${crossings} times; moving a part can untangle them`);
  const tags = L.routes.filter((r) => r.label && r.labelAt).map((r) => ({ id: r.id, x0: r.labelAt.x - r.labelAt.w / 2, x1: r.labelAt.x + r.labelAt.w / 2, y0: r.labelAt.y - 7.5, y1: r.labelAt.y + 7.5 }));
  for (const t of tags) {
    for (const q of boxes) if (rectsOverlap(t, rectOf(q), 1)) warnings.push(`${at}: the tag on route ${t.id} covers "${q.id}"`);
    for (const w of L.texts) if (rectsOverlap(t, w, 1)) warnings.push(`${at}: the tag on route ${t.id} covers the words of "${w.id}"`);
  }
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (rectsOverlap(tags[i], tags[j], 1)) warnings.push(`${at}: the tags on routes ${tags[i].id} and ${tags[j].id} overlap`);
  for (const q of boxes) {
    const p = q.part;
    if (p.kind !== "station") continue;
    const name = fitText(p.label, q.w - 46, 12.5);
    if (name.cut) warnings.push(`${at}: the name "${p.label}" is cut to "${name.text}"; give it a shorter label`);
    const spec = fitText(specOf(p, lv.unit), q.w - 24 - (p.inside ? 30 : 0), 10, 9);
    if (spec.cut) notes.push(`${at}: the line under "${p.label}" is cut to "${spec.text}"; set a shorter spec`);
  }
  if (L.width > WIDE) warnings.push(`${at}: the drawing is ${L.width} px wide; above about ${WIDE} it gets small on a laptop. Move some steps inside one (inside)`);
  const steps = lv.parts.filter((p) => p.kind === "station").length;
  if (steps > 8) notes.push(`${at}: ${steps} steps on one level; a level reads best with 3 to 7. Group some inside a step`);
  for (const lane of L.lanes) if (lane.empty) warnings.push(`${at}: lane "${lane.id}" has no parts`);
  return { errors, warnings, notes, crossings };
}

// ---- the run ----------------------------------------------------------------------------
/**
 * Numbers a claim can name:
 *   lead.p50  lead.p95  lead.p99  lead.mean   time from start to end, all items of the run
 *   done  throughput                       items finished; per unit of time over the horizon
 *   outcome.<name>                         share of finished items with that outcome
 *   <station>.utilization                  busy share of its capacity over the horizon
 *   <station>.wait  <station>.p95wait      waiting time before it, per item
 *   <station>.waitShare                    share of all items' time spent waiting for it
 *   <station>.done
 *   <station>.timeoutShare  <station>.rejectShare   share of its arrivals that gave up or were turned away
 *   <station>.failShare                             share of its finished items that failed
 */
export function metricsOf(def, seed) {
  const all = simulate(def, { seed }).stats();
  const day = createSim(def, { seed }).runUntil(def.horizon ?? 600).stats();
  const m = { "lead.p50": all.p50Lead, "lead.p95": all.p95Lead, "lead.p99": all.p99Lead, "lead.mean": all.meanLead, done: all.done, throughput: day.done / Math.max(1e-9, day.t) };
  for (const [k, v] of Object.entries(all.outcomes)) m[`outcome.${k}`] = v / Math.max(1, all.done);
  const total = all.meanLead * all.done;
  for (const [path, s] of Object.entries(all.stations)) {
    m[`${path}.utilization`] = day.stations[path].utilization;
    m[`${path}.wait`] = s.meanWait;
    m[`${path}.p95wait`] = s.p95Wait;
    m[`${path}.waitShare`] = total > 0 ? (s.meanWait * s.started) / total : 0;
    m[`${path}.done`] = s.finished;
    m[`${path}.timeoutShare`] = s.arrivals ? s.timedOut / s.arrivals : 0;
    m[`${path}.rejectShare`] = s.arrivals ? s.rejected / s.arrivals : 0;
    m[`${path}.failShare`] = s.finished ? s.failed / s.finished : 0;
  }
  return { m, all, day };
}

function checkClaim(c, m) {
  const v = m[c.metric];
  if (v == null || Number.isNaN(v)) return `names "${c.metric}", which the run does not measure`;
  const tol = c.tol ?? 0.15;
  if (c.min != null && v < c.min) return `${c.metric} is ${round(v)}, below ${c.min}`;
  if (c.max != null && v > c.max) return `${c.metric} is ${round(v)}, above ${c.max}`;
  if (c.near != null && Math.abs(v - c.near) > tol * Math.abs(c.near)) return `${c.metric} is ${round(v)}, not within ${Math.round(tol * 100)}% of ${c.near}`;
  return null;
}
const round = (v) => (Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000);

/** Run checks on the model's seed and on `seeds` more. */
export function auditRun(model, def, { seeds = 8 } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const base = model.seed;
  const runs = [];
  for (let k = 0; k < seeds; k++) {
    const seed = base + k;
    const sim = simulate(def, { seed });
    runs.push({ seed, sim, ...metricsOf(def, seed) });
  }
  const first = runs[0];
  if (first.all.done === 0) errors.push("no item reaches an end: check the starts and the horizon");
  for (const r of runs) if (r.all.inSystem > 0) errors.push(`seed ${r.seed}: ${r.all.inSystem} items are still inside when nothing is left to happen; something holds them (a join without all its branches?)`);
  if (first.sim.log.length > 150000) warnings.push(`the run has ${first.sim.log.length} events; the page will be heavy. Shorten the horizon or slow the arrivals`);
  // stability: a queue that grows all day says the step cannot keep up (a batch, where every start has a count, is meant to drain)
  const batch = model.parts.filter((p) => p.kind === "start").every((p) => p.count != null);
  for (const path of batch ? [] : Object.keys(first.day.stations)) {
    const us = runs.map((r) => r.day.stations[path].utilization).filter((u) => u != null).sort((a, b) => a - b);
    if (!us.length) continue;
    const med = us[Math.floor(us.length / 2)];
    if (med >= 0.95) warnings.push(`"${path}" is busy ${Math.round(med * 100)}% of the time: over a longer run its queue grows without limit. Give it capacity, or say in the prose that it cannot keep up`);
  }
  // routes and parts no item ever uses
  const used = new Map();
  for (const r of runs) for (const [k, n] of Object.entries(r.all.routes)) used.set(k, (used.get(k) || 0) + n);
  for (const lv of levelsOf(model))
    for (const rt of lv.routes) {
      const key = `${lv.path}::${rt.id}`;
      if (used.get(key)) continue;
      if (rt.seldom) notes.push(`route ${rt.id} (${where(lv)}) is not taken in ${seeds} runs, as marked (seldom): the reader sees it only after a what-if`);
      else warnings.push(`route ${rt.id} (${where(lv)}) is never taken in ${seeds} runs; the reader will never see it work. Raise its chance, mark it seldom (a what-if path), or drop it`);
    }
  // decisions by chance should match their p (a check on the simulator itself)
  for (const lv of levelsOf(model))
    for (const p of lv.parts.filter((q) => q.kind === "choice")) {
      const outs = lv.outs.get(p.id).filter((r) => r.p != null);
      if (!outs.length) continue;
      const path = lv.path ? `${lv.path}/${p.id}` : p.id;
      const counts = runs.reduce((acc, r) => {
        const c = r.all.choices[path] || {};
        for (const [k, v] of Object.entries(c)) acc[k] = (acc[k] || 0) + v;
        return acc;
      }, {});
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      if (n < 50) continue;
      for (const r of outs) {
        const obs = (counts[r.id] || 0) / n;
        const sd = Math.sqrt((r.p * (1 - r.p)) / n);
        if (Math.abs(obs - r.p) > 5 * sd + 1e-9) errors.push(`choice "${path}" took route ${r.id} ${Math.round(obs * 100)}% of the time, expected ${Math.round(r.p * 100)}%`);
      }
    }
  // claims: true on the figure's own seed, and on most seeds
  for (const c of def.claims || []) {
    const bad = checkClaim(c, first.m);
    const say = c.say ? ` ("${c.say}")` : "";
    if (bad) errors.push(`claim${say}: on the figure's seed, ${bad}`);
    const misses = runs.filter((r) => checkClaim(c, r.m)).length;
    if (!bad && misses > seeds / 2) warnings.push(`claim${say} holds on the figure's seed but fails on ${misses} of ${seeds} seeds: it is luck, not the process`);
    else if (!bad && misses) notes.push(`claim${say} holds on ${seeds - misses} of ${seeds} seeds`);
  }
  const med = (k) => runs.map((r) => r.m[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  notes.push(`median over ${seeds} seeds: lead time p50 ${round(med("lead.p50"))} ${model.unit}, p95 ${round(med("lead.p95"))} ${model.unit}; the figure's seed: ${round(first.m["lead.p50"])} and ${round(first.m["lead.p95"])}`);
  return { errors, warnings, notes, metrics: first.m };
}

/** Everything. Returns { errors, warnings, notes, metrics }. */
export function audit(def, opts = {}) {
  const { errors, warnings, model } = validate(def);
  const out = { errors: [...errors], warnings: [...warnings], notes: [], metrics: null };
  if (errors.length) return out;
  for (const lv of levelsOf(model)) {
    const r = auditLayout(lv, layout(lv, opts.layout));
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
    out.notes.push(...r.notes);
  }
  const run = auditRun(model, def, opts);
  out.errors.push(...run.errors);
  out.warnings.push(...run.warnings);
  out.notes.push(...run.notes);
  out.metrics = run.metrics;
  return out;
}

export function report(r) {
  const lines = [];
  for (const e of r.errors) lines.push(`error    ${e}`);
  for (const w of r.warnings) lines.push(`warning  ${w}`);
  for (const n of r.notes) lines.push(`note     ${n}`);
  lines.push(r.errors.length ? `audit failed: ${r.errors.length} error(s), ${r.warnings.length} warning(s)` : r.warnings.length ? `audit passed with ${r.warnings.length} warning(s)` : "audit passed");
  return lines.join("\n");
}

/** The --audit hook: print the report; exit 1 on errors (and on warnings with strict). */
export function auditOrExit(def, opts = {}) {
  const r = audit(def, opts);
  console.log(report(r));
  if (r.errors.length || (opts.strict && r.warnings.length)) process.exit(1);
  return r;
}

