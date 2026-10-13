// The floor plan. Parts are placed by hand on a grid (`lane`, `at: [column,
// row]`), the way a draughtsman plans a sheet, and this module turns that plan
// into coordinates, ports and routes.
//
// Columns are as wide as their widest part, plus room on the input side of a
// station for its queue: work waits on the rail that leads into it. Routes are
// orthogonal with rounded bends. Each is chosen from many candidate paths by a
// cost: length, bends, a part crossed (never), another route run over, ports
// that break the grammar of the drawing. The grammar is BPMN's: work enters a
// step from the left and leaves on the right, a branch leaves its gateway from
// the vertex that faces its target, a merge enters a join the same way, and a
// loop back (a retry, a rework) returns under the parts it skips.

import { dedupe, roundedPath, lengthOf, segmentsOf, segHitsRect, overlapLength, crosses, rectOf, rectsOverlap } from "./geom.mjs";
import { short, rateWords } from "./dist.mjs";
import { wideWidth } from "./metrics.mjs";

export const DEFAULTS = {
  row: 100, // row pitch inside a lane
  pad: 26, // margin around the sheet
  laneHead: 40, // the lane plate column on the left (only when some lane has a label)
  lanePad: 18, // room above and below a lane's rows
  gutter: 38, // room before a gateway or an event
  queueRoom: 72, // room before a station: its queue forms there
  after: 18, // room after every column
  emptyCol: 56, // a skipped column number
  loopGap: 26, // first return channel under a lane's lowest part
  loopStep: 12, // spacing between stacked return channels
  radius: 10, // bend radius
  stub: 14, // straight run out of a port before the first bend
};

export const SIZES = {
  station: [136, 70],
  open: [148, 80], // a station with an inside
  choice: [40, 40],
  split: [40, 40],
  join: [40, 40],
  start: [34, 34],
  end: [34, 34],
  timer: [36, 36],
  store: [62, 46],
};

const BEND = 22;
const HIT = 6000;
const TEXT_HIT = 2500;

// the smallest size the page sets a step's name in: it shrinks a long name down to this before it cuts it
const NAME_MIN = 10.5;

// a switch takes this much of the name's row (its track and a gap), and so does a settings badge
export const SWITCH_ROOM = 26;
export const SETTINGS_ROOM = 22;
/** A part whose settings open in a panel on the figure: it has dials, or servers that scale. */
export const hasSettings = (p) => Boolean(p.dials?.length || p.scale);

function sizeOf(p) {
  if (p.size) return p.size;
  if (p.kind === "station") {
    const [w, h] = p.inside ? SIZES.open : SIZES.station;
    // wide enough for its name in a wide font, clear of the icon (and of the lamp an open step carries, and of its switch)
    const named = Math.ceil(wideWidth(p.label || p.id, NAME_MIN, true)) + (p.inside ? 56 : 46) + (p.switch ? SWITCH_ROOM : 0) + (hasSettings(p) ? SETTINGS_ROOM : 0) + 2;
    // a station that scales shows a bay for every server it can have
    return [Math.max(w, named, p.scale ? 150 : 0), h];
  }
  return SIZES[p.kind] || [40, 40];
}

/** Where a choice's switch sits: under the diamond, or over it when its ways out go down. */
export function choiceSwitchAt(box, boxes, routes) {
  const outs = routes.filter((r) => r.from === box.id).map((r) => boxes[r.to]);
  const down = outs.some((b) => b && b.y > box.y + 1);
  const up = outs.some((b) => b && b.y < box.y - 1);
  return { x: box.x - 11, y: down && !up ? box.y - box.h / 2 - 17 : box.y + box.h / 2 + 5 };
}

function portsOf(box) {
  const { x, y, w, h } = box;
  return { n: [x, y - h / 2], s: [x, y + h / 2], e: [x + w / 2, y], w: [x - w / 2, y] };
}

const DIR = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
const OPP = { e: "w", w: "e", n: "s", s: "n" };

/**
 * Lay out one level of a model. Returns
 *   { width, height, lanes: [{ id, label, y, h }], parts: { id: box },
 *     routes: [{ id, key, from, to, points, d, length, label, labelAt, back, exit, entry }],
 *     uses: [{ from, to, points, d }], columns: [{ col, x, left, right }] }
 * where a box is { id, kind, part, x, y, w, h, ports, flip }.
 */
export function layout(model, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const parts = model.parts;
  const colOf = new Map(parts.map((p) => [p.id, p.at[0]]));

  // a part whose work comes in from the right and leaves to the left (a rework
  // step in a return lane) is drawn flipped: its queue forms on its right
  const flips = new Map();
  for (const p of parts) {
    const ins = model.ins.get(p.id) || [];
    const outs = model.outs.get(p.id) || [];
    const c = p.at[0];
    // work that comes in from the right and goes on to the left (or straight down): the part runs right to left
    const fromRight = ins.some((r) => colOf.get(r.from) > c) || (ins.length > 0 && ins.every((r) => colOf.get(r.from) === c) && outs.some((r) => colOf.get(r.to) < c));
    const auto = outs.length > 0 && fromRight && outs.every((r) => colOf.get(r.to) <= c) && ins.every((r) => colOf.get(r.from) >= c);
    flips.set(p.id, p.flip ?? (p.kind !== "start" && p.kind !== "end" && p.kind !== "store" && auto));
  }

  // ---- columns -------------------------------------------------------------
  const cols = [...new Set(parts.map((p) => p.at[0]))].sort((a, b) => a - b);
  const anyLabel = model.lanes.some((l) => l.label);
  let x = o.pad + (anyLabel ? o.laneHead : 0);
  const columns = [];
  cols.forEach((c, i) => {
    if (i > 0) {
      const prev = cols[i - 1];
      const missing = Math.floor(c - 1e-9) - Math.ceil(prev + 1e-9) + 1;
      if (missing > 0) x += missing * o.emptyCol;
    }
    const inCol = parts.filter((p) => p.at[0] === c);
    const maxW = Math.max(...inCol.map((p) => sizeOf(p)[0]));
    // room for a queue only where one can form: limited capacity, and a queue allowed
    const queued = (p) => p.kind === "station" && p.servers !== "inf" && Number.isFinite(p.servers) && p.capacity !== 0;
    // a tagged route that ends in this column needs room for its tag on the way in
    const tagRoom = Math.max(0, ...model.routes.filter((r) => inCol.some((p) => p.id === r.to) && colOf.get(r.from) < c && (r.label ?? (r.when && r.when !== "else" ? r.when : r.p != null ? "00%" : ""))).map((r) => tagWidth(String(r.label ?? (r.when && r.when !== "else" ? r.when : `${Math.round((r.p ?? 0) * 100)}%`))) + 30));
    const left = Math.max(tagRoom, ...inCol.map((p) => (queued(p) && !flips.get(p.id) ? o.queueRoom : o.gutter)));
    const right = Math.max(...inCol.map((p) => (queued(p) && flips.get(p.id) ? o.queueRoom : o.after)));
    const center = x + left + maxW / 2;
    columns.push({ col: c, x: center, left: x, right: x + left + maxW + right, maxW });
    x += left + maxW + right;
  });
  const width = x + o.pad;
  const colX = new Map(columns.map((c) => [c.col, c.x]));

  // ---- lanes, top to bottom --------------------------------------------------
  const back = model.routes.filter((r) => colOf.get(r.to) < colOf.get(r.from));
  const laneOfPart = new Map(parts.map((p) => [p.id, p.lane]));
  let y = o.pad;
  const lanes = [];
  for (const lane of model.lanes) {
    const rows = parts.filter((p) => p.lane === lane.id).map((p) => p.at[1]);
    const minRow = rows.length ? Math.min(...rows) : 0;
    const maxRow = rows.length ? Math.max(...rows) : 0;
    const loops = back.filter((r) => laneOfPart.get(r.from) === lane.id && laneOfPart.get(r.to) === lane.id).length;
    const h = o.lanePad * 2 + (maxRow - minRow + 1) * o.row + (loops ? Math.max(0, o.loopGap + (loops - 1) * o.loopStep - o.lanePad + 8) : 0);
    lanes.push({ id: lane.id, label: lane.label || "", note: lane.note, y, h, minRow, maxRow, empty: rows.length === 0 });
    y += h;
  }
  const height = y + o.pad;

  const boxes = {};
  for (const p of parts) {
    const lane = lanes.find((l) => l.id === p.lane);
    const [w, h] = sizeOf(p);
    const cx = colX.get(p.at[0]);
    const cy = lane.y + o.lanePad + (p.at[1] - lane.minRow + 0.5) * o.row;
    const box = { id: p.id, kind: p.kind, part: p, x: cx, y: cy, w, h, flip: flips.get(p.id) };
    box.ports = portsOf(box);
    boxes[p.id] = box;
  }
  const allBoxes = Object.values(boxes);

  // the words around small parts are part of the floor plan: routes keep off them.
  // A gateway's label takes the first place that is clear of parts and words.
  const texts = [];
  const gates = allBoxes.filter((b) => b.kind === "choice" || b.kind === "split" || b.kind === "join");
  for (const box of allBoxes) {
    if (gates.includes(box)) continue;
    box.texts = textsOf(box, model, model.routes);
    for (const t of box.texts) texts.push({ ...textRect(t), id: box.id });
  }
  // a small part's settings badge sits on its left, where nothing enters a start: words and routes keep off it
  for (const box of allBoxes) {
    if (box.kind === "station" || !hasSettings(box.part)) continue;
    box.settingsAt = { x: box.x - box.w / 2 - 24, y: box.y - 8 };
    const at = box.settingsAt;
    texts.push({ x0: at.x - 3, y0: at.y - 3, x1: at.x + 19, y1: at.y + 19, id: box.id, control: true });
  }
  // a choice's switch is under its diamond: words and routes keep off it
  for (const box of gates) {
    if (!box.part.switch) continue;
    box.switchAt = choiceSwitchAt(box, boxes, model.routes);
    const at = box.switchAt;
    texts.push({ x0: at.x - 3, y0: at.y - 3, x1: at.x + 25, y1: at.y + 15, id: box.id, control: true });
  }
  for (const box of gates) {
    box.texts = gateLabel(box, model, allBoxes, texts);
    for (const t of box.texts) texts.push({ ...textRect(t), id: box.id });
  }

  // ---- routes --------------------------------------------------------------------
  const routed = [];
  const order = model.routes
    .map((r) => {
      const A = boxes[r.from];
      const B = boxes[r.to];
      const isBack = colOf.get(r.to) < colOf.get(r.from);
      return { r, rank: (isBack ? 2 : Math.abs(A.y - B.y) < 1 ? 0 : 1) * 1e6 + Math.abs(B.x - A.x) + r.index };
    })
    .sort((a, b) => a.rank - b.rank)
    .map((e) => e.r);

  const result = new Map();
  for (const r of order) {
    const best = routeOne(r, boxes[r.from], boxes[r.to], { boxes: allBoxes, texts, routed, o, columns, lanes });
    routed.push(best);
    result.set(r.id, best);
  }

  const routes = model.routes.map((r) => {
    const best = result.get(r.id);
    const pts = best.points;
    const label = r.label ?? (r.when && r.when !== "else" ? r.when : r.p != null ? `${Math.round(r.p * 100)}%` : null);
    // a cap reads "retry ≤2" on a default tag; a tag the author wrote says what it means already
    const text = label && r.max && r.label == null ? `${label} ≤${r.max}` : label;
    return {
      id: r.id,
      key: `${model.path}::${r.id}`,
      from: r.from,
      to: r.to,
      when: r.when,
      p: r.p,
      max: r.max,
      points: pts,
      d: roundedPath(pts, o.radius),
      length: lengthOf(pts),
      label: text,
      exit: best.exit,
      entry: best.entry,
      back: colOf.get(r.to) < colOf.get(r.from),
    };
  });
  placeLabels(routes, allBoxes, boxes, texts);

  // a tag sits on its own rail and on no other: a route that runs under another's tag is routed again, round the tags
  const stuck = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const tags = routes.filter((rt) => rt.labelAt).map((rt) => ({ ...tagBox(rt.labelAt, 3), id: rt.id }));
    const under = routes.find((rt) => !stuck.has(rt.id) && tags.some((t) => t.id !== rt.id && segmentsOf(rt.points).some((s) => segHitsRect(s, t))));
    if (!under) break;
    const r = model.routes.find((q) => q.id === under.id);
    const avoid = tags.filter((t) => t.id !== under.id);
    const before = result.get(under.id);
    const best = routeOne(r, boxes[r.from], boxes[r.to], { boxes: allBoxes, texts: [...texts, ...avoid], routed: routed.filter((b) => b !== before), o, columns, lanes });
    if (!best || segmentsOf(best.points).some((s) => avoid.some((t) => segHitsRect(s, t)))) {
      stuck.add(under.id);
      continue;
    }
    routed[routed.indexOf(before)] = best;
    result.set(under.id, best);
    Object.assign(under, { points: best.points, d: roundedPath(best.points, o.radius), length: lengthOf(best.points), exit: best.exit, entry: best.entry });
    placeLabels(routes, allBoxes, boxes, texts);
  }

  // a station's links to the stores it uses
  const uses = [];
  for (const p of parts.filter((q) => q.kind === "station" && q.uses)) {
    for (const sid of p.uses) {
      const a = boxes[p.id];
      const b = boxes[sid];
      if (!b) continue;
      const down = b.y > a.y;
      const pa = down ? a.ports.s : a.ports.n;
      const pb = down ? b.ports.n : b.ports.s;
      const mid = (pa[1] + pb[1]) / 2;
      const pts = dedupe([pa, [pa[0], mid], [pb[0], mid], pb]);
      uses.push({ from: p.id, to: sid, points: pts, d: roundedPath(pts, 6) });
    }
  }

  return { width: Math.ceil(width), height: Math.ceil(height), lanes, parts: boxes, routes, uses, columns, texts, options: o };
}

// ---- one route ----------------------------------------------------------------------
// Any side of a part may carry a route, at a price: work enters on the input
// side and leaves on the output side for free; the top and bottom cost a
// little (a branch off a gateway toward its target costs nothing); going in
// through the output side or out through the input side reads backwards.
const SIDES = ["e", "w", "n", "s"];
const mainIn = (box) => (box.flip ? "e" : "w");
const mainOut = (box) => (box.flip ? "w" : "e");

function exitSides(A) {
  return A.kind === "end" || A.kind === "store" ? [] : SIDES;
}
function entrySides(B) {
  return B.kind === "start" || B.kind === "store" ? [] : SIDES;
}

function exitPenalty(A, side, B) {
  if (side === mainOut(A)) return 0;
  if (side === mainIn(A)) return 400;
  if (A.kind === "choice" || A.kind === "split") {
    if (side === "n" && B.y < A.y - 1) return 0;
    if (side === "s" && B.y > A.y + 1) return 0;
    return side === "n" ? 34 : 30;
  }
  return side === "n" ? 44 : 40;
}
function entryPenalty(B, side, A) {
  if (side === mainIn(B)) return 0;
  if (side === mainOut(B)) return B.kind === "end" ? 40 : 400;
  if (B.kind === "join") {
    if (side === "n" && A.y < B.y - 1) return 0;
    if (side === "s" && A.y > B.y + 1) return 0;
    return 30;
  }
  return side === "n" ? 44 : 40;
}

/** Attachment points on one side: a station's top and bottom take three, so a round trip runs on two lines. */
function portsOn(box, side) {
  const p = box.ports[side];
  if (box.kind !== "station" || side === "e" || side === "w") return [{ p, off: 0 }];
  const k = Math.min(26, box.w / 2 - 22);
  return [{ p, off: 0 }, { p: [p[0] - k, p[1]], off: -k }, { p: [p[0] + k, p[1]], off: k }];
}

function routeOne(r, A, B, ctx) {
  const { o } = ctx;
  let best = null;
  for (const es of exitSides(A)) {
    for (const ns of entrySides(B)) {
      for (const { p: pa, off: oa } of portsOn(A, es)) {
        for (const { p: pb, off: ob } of portsOn(B, ns)) {
          const da = DIR[es];
          const db = DIR[OPP[ns]]; // direction of travel when arriving
          const a = [pa[0] + da[0] * o.stub, pa[1] + da[1] * o.stub];
          const b = [pb[0] - db[0] * o.stub, pb[1] - db[1] * o.stub];
          const offCost = (oa ? 8 : 0) + (ob ? 8 : 0);
          for (const mid of middles(a, b, A, B, ctx)) {
            const pts = dedupe([pa, a, ...mid, b, pb]);
            if (!valid(pts)) continue;
            const cost = scoreOf(pts, r, A, B, es, ns, ctx) + exitPenalty(A, es, B) + entryPenalty(B, ns, A) + offCost;
            if (!best || cost < best.cost) best = { points: pts, cost, exit: es, entry: ns, from: r.from, to: r.to, segs: segmentsOf(pts) };
          }
        }
      }
    }
  }
  return best;
}

/** Candidate middles between the two stub ends a and b. */
function middles(a, b, A, B, ctx) {
  const { o, columns } = ctx;
  const out = [[]];
  out.push([[b[0], a[1]]], [[a[0], b[1]]]);
  const xs = new Set([(a[0] + b[0]) / 2]);
  const lo = Math.min(a[0], b[0]);
  const hi = Math.max(a[0], b[0]);
  for (const c of columns) {
    // vertical channels just past each column, clear of the next one's queue
    for (const dx of [4, 12, 22]) {
      const cx = c.right + dx;
      if (cx > lo - 40 && cx < hi + 40) xs.add(cx);
    }
  }
  // and just past the words in the way, so a route can go round a label instead of through it
  const ylo = Math.min(a[1], b[1]);
  const yhi = Math.max(a[1], b[1]);
  for (const t of ctx.texts) {
    if (t.y1 < ylo - 40 || t.y0 > yhi + 40) continue;
    if (t.x1 > lo - 60 && t.x1 < hi + 60) xs.add(t.x1 + 6);
    if (t.x0 > lo - 60 && t.x0 < hi + 60) xs.add(t.x0 - 6);
  }
  for (const x of xs) out.push([[x, a[1]], [x, b[1]]]);
  const ys = new Set([(a[1] + b[1]) / 2]);
  for (const t of ctx.texts) {
    if (t.x1 < lo - 40 || t.x0 > hi + 40) continue;
    if (t.y1 > ylo - 60 && t.y1 < yhi + 60) ys.add(t.y1 + 6);
    if (t.y0 > ylo - 60 && t.y0 < yhi + 60) ys.add(t.y0 - 6);
  }
  const span = ctx.boxes.filter((q) => q.x + q.w / 2 > lo - 30 && q.x - q.w / 2 < hi + 30);
  const bottom = Math.max(A.y + A.h / 2, B.y + B.h / 2, ...span.filter((q) => Math.abs(q.y - A.y) < o.row * 1.6 || Math.abs(q.y - B.y) < o.row * 1.6).map((q) => q.y + q.h / 2));
  const top = Math.min(A.y - A.h / 2, B.y - B.h / 2, ...span.filter((q) => Math.abs(q.y - A.y) < o.row * 1.6 || Math.abs(q.y - B.y) < o.row * 1.6).map((q) => q.y - q.h / 2));
  for (let k = 0; k < 5; k++) {
    ys.add(bottom + o.loopGap * 0.7 + k * o.loopStep);
    ys.add(top - o.loopGap * 0.7 - k * o.loopStep);
  }
  for (const y of [A.y, B.y]) {
    ys.add(y + o.row / 2);
    ys.add(y - o.row / 2);
  }
  for (const y of ys) out.push([[a[0], y], [b[0], y]]);
  // two-channel detours (around a part that sits in the way)
  for (const y of ys) for (const x of [(a[0] + b[0]) / 2]) out.push([[a[0], y], [x, y], [x, b[1]]], [[x, a[1]], [x, y], [b[0], y]]);
  return out;
}

/** No zero-width U-turns: consecutive segments may not double back. */
function valid(pts) {
  if (pts.length < 2) return false;
  for (let i = 2; i < pts.length; i++) {
    const ux = pts[i - 1][0] - pts[i - 2][0];
    const uy = pts[i - 1][1] - pts[i - 2][1];
    const vx = pts[i][0] - pts[i - 1][0];
    const vy = pts[i][1] - pts[i - 1][1];
    if (ux * vx + uy * vy < -1e-6) return false;
    // orthogonal only
    if (Math.abs(vx) > 0.01 && Math.abs(vy) > 0.01) return false;
  }
  const ux = pts[1][0] - pts[0][0];
  const uy = pts[1][1] - pts[0][1];
  return !(Math.abs(ux) > 0.01 && Math.abs(uy) > 0.01);
}

function scoreOf(pts, r, A, B, es, ns, ctx) {
  const { o } = ctx;
  const segs = segmentsOf(pts);
  let cost = lengthOf(pts) + (pts.length - 2) * BEND;
  const last = segs.length - 1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const q of ctx.boxes) {
      const own = q.id === A.id || q.id === B.id;
      const end = (q.id === A.id && i === 0) || (q.id === B.id && i === last);
      const rect = own ? (end ? rectOf(q, -1.5) : rectOf(q, 4)) : rectOf(q, 7);
      if (segHitsRect(s, rect)) cost += HIT;
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // a run that hugs a part (alongside it, closer than a tag is tall) leaves no room for words and reads as its edge
    if (Math.abs(s[1] - s[3]) < 0.01 && i > 0 && i < segs.length - 1) {
      const lo = Math.min(s[0], s[2]);
      const hi = Math.max(s[0], s[2]);
      for (const q of ctx.boxes) {
        if (q.x + q.w / 2 < lo || q.x - q.w / 2 > hi) continue;
        const gap = Math.min(Math.abs(s[1] - (q.y - q.h / 2)), Math.abs(s[1] - (q.y + q.h / 2)));
        if (gap < 16 && !(s[1] > q.y - q.h / 2 && s[1] < q.y + q.h / 2)) cost += 70;
      }
    }
  }
  for (const s of segs) {
    for (const t of ctx.texts) if (segHitsRect(s, t)) cost += TEXT_HIT;
    // a run along a lane boundary reads as the boundary
    if (Math.abs(s[1] - s[3]) < 0.01) for (const lane of ctx.lanes) if (lane.y > ctx.o.pad + 1 && Math.abs(s[1] - lane.y) < 7) cost += 90;
  }
  for (const other of ctx.routed) {
    const shareFrom = other.from === r.from && other.exit === es;
    const shareTo = other.to === r.to && other.entry === ns;
    for (const s of segs)
      for (const t of other.segs) {
        const ov = overlapLength(s, t, 4);
        if (ov > 3) {
          if (!shareFrom && !shareTo) cost += 420 + ov * 3;
        } else if (crosses(s, t)) cost += 26;
      }
  }
  // a station's queue forms on the last straight run into it: keep that run long
  if (B.kind === "station" && Number.isFinite(B.part.servers) && B.part.capacity !== 0 && ns === mainIn(B)) {
    const s = segs[last];
    const run = Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]);
    if (run < o.queueRoom - 10) cost += (o.queueRoom - 10 - run) * 2.5;
  }
  return cost;
}

// ---- labels on routes -------------------------------------------------------------------
// a tag's room in a wide font (bold, spaced .02em, 7 px either side); the page draws the pill to its words
export const tagWidth = (text) => wideWidth(text, 9.5, true) + String(text).length * 0.19 + 14;

function placeLabels(routes, allBoxes, boxes, texts) {
  const placed = [];
  for (const rt of routes) {
    if (!rt.label) continue;
    const w = tagWidth(rt.label);
    const h = 15;
    const cands = [];
    const target = boxes[rt.to];
    const queues = target.kind === "station" && Number.isFinite(target.part.servers) && target.part.capacity !== 0;
    const keepClear = queues ? 82 : 14; // the queue rail before a station
    let acc = 0;
    const total = rt.length;
    for (let i = 1; i < rt.points.length; i++) {
      const [ax, ay] = rt.points[i - 1];
      const [bx, by] = rt.points[i];
      const l = Math.hypot(bx - ax, by - ay);
      const horiz = Math.abs(ay - by) < 0.5;
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const half = (horiz ? w : h) / 2 + 8;
        if (l < half * 2) continue;
        const s = acc + half + (l - half * 2) * u;
        if (s > total - keepClear - (horiz ? w / 2 : 0)) continue;
        const t = (s - acc) / l;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        // prefer near the gateway, on a horizontal run
        cands.push({ x, y, w, h, cost: (horiz ? 0 : 30) + s * 0.08 });
      }
      acc += l;
    }
    if (!cands.length) {
      const mid = total / 2;
      let a2 = 0;
      for (let i = 1; i < rt.points.length; i++) {
        const l = Math.hypot(rt.points[i][0] - rt.points[i - 1][0], rt.points[i][1] - rt.points[i - 1][1]);
        if (a2 + l >= mid) {
          const t = (mid - a2) / (l || 1);
          cands.push({ x: rt.points[i - 1][0] + (rt.points[i][0] - rt.points[i - 1][0]) * t, y: rt.points[i - 1][1] + (rt.points[i][1] - rt.points[i - 1][1]) * t, w, h, cost: 0 });
          break;
        }
        a2 += l;
      }
    }
    for (const c of cands) {
      const rect = { x0: c.x - c.w / 2, y0: c.y - c.h / 2, x1: c.x + c.w / 2, y1: c.y + c.h / 2 };
      for (const q of allBoxes) if (rectsOverlap(rect, rectOf(q), 3)) c.cost += 1000;
      for (const t of texts) if (rectsOverlap(rect, t, 2)) c.cost += 900;
      for (const p of placed) if (rectsOverlap(rect, p, 3)) c.cost += 800;
      for (const other of routes) {
        if (other === rt) continue;
        for (const s of segmentsOf(other.points)) if (segHitsRect(s, rect)) c.cost += 60;
      }
    }
    cands.sort((a, b) => a.cost - b.cost);
    const c = cands[0];
    rt.labelAt = { x: c.x, y: c.y, w: c.w, h: c.h };
    placed.push({ x0: c.x - c.w / 2, y0: c.y - c.h / 2, x1: c.x + c.w / 2, y1: c.y + c.h / 2 });
  }
}

// ---- words around small parts ---------------------------------------------------------
// words are budgeted in a wide font (kit/metrics.mjs), so routes keep clear of them in any font the reader has
export const textWidth = (text, size, bold = false) => wideWidth(text, size, bold);

/** Where a part's words go: { text, x, y (baseline), anchor, strong, size }. */
export function textsOf(box, model, routes) {
  const p = box.part;
  const { x, y, h } = box;
  const r = h / 2;
  const named = p.label && p.label !== p.id;
  const out = [];
  const add = (text, tx, ty, anchor = "middle", strong = false, size = 10, role = null) => out.push({ text, x: tx, y: ty, anchor, strong, size, role });
  switch (p.kind) {
    case "start":
      add(p.label || p.id, x, y - r - 8, "middle", true);
      // the page keeps this up to date when the reader changes the rate
      if (p.every != null) add(rateWords(p.every, model.unit, model.per), x, y + r + 14, "middle", false, 10, "rate");
      break;
    case "end":
      add(named || p.named ? p.label : p.outcome || p.id, x, y + r + 14, "middle", true);
      break;
    case "timer":
      // below the orbit where waiting items ride the rim
      add(named ? p.label : "wait", x, y + r + 23, "middle", true);
      add(short(p.wait, model.unit), x, y + r + 35);
      break;
    case "store":
      add(p.label || p.id, x, y + r + 14, "middle", true);
      break;
  }
  return out;
}

/** A gateway's label: tried above and below, left, centre and right; the first clear place wins. */
function gateLabel(box, model, boxes, texts) {
  const p = box.part;
  if (!p.label || p.label === p.id) return [];
  const { x, y, h } = box;
  const r = h / 2;
  const others = model.routes.filter((q) => q.from === p.id || q.to === p.id).map((q) => boxes.find((b) => b.id === (q.from === p.id ? q.to : q.from)));
  const up = others.some((b) => b.y < y - 1);
  const down = others.some((b) => b.y > y + 1);
  const cands = [
    { text: p.label, x: x - 9, y: y - r - 6, anchor: "end", pref: 0 },
    { text: p.label, x: x + 9, y: y - r - 6, anchor: "start", pref: 6 },
    { text: p.label, x, y: y - r - 8, anchor: "middle", pref: up ? 400 : 3 },
    { text: p.label, x: x - 9, y: y + r + 16, anchor: "end", pref: 14 },
    { text: p.label, x: x + 9, y: y + r + 16, anchor: "start", pref: 18 },
    { text: p.label, x, y: y + r + 17, anchor: "middle", pref: down ? 400 : 22 },
  ].map((c) => ({ ...c, strong: true, size: 10 }));
  let best = null;
  for (const c of cands) {
    const rect = textRect(c);
    let cost = c.pref;
    for (const b of boxes) if (rectsOverlap(rect, rectOf(b), 3)) cost += 1000;
    for (const t of texts) if (rectsOverlap(rect, t, 2)) cost += 800;
    // words too close to other words read as one phrase
    for (const t of texts) if (!rectsOverlap(rect, t, 2) && rectsOverlap(rect, t, 14)) cost += 40;
    if (!best || cost < best.cost) best = { ...c, cost };
  }
  const { cost, pref, ...t } = best;
  void cost;
  void pref;
  return [t];
}

const tagBox = (at, pad = 0) => ({ x0: at.x - at.w / 2 - pad, y0: at.y - at.h / 2 - pad, x1: at.x + at.w / 2 + pad, y1: at.y + at.h / 2 + pad });

export function textRect(t) {
  const w = textWidth(t.text, t.size, t.strong);
  const x0 = t.anchor === "end" ? t.x - w : t.anchor === "start" ? t.x : t.x - w / 2;
  return { x0: x0 - 2, x1: x0 + w + 2, y0: t.y - t.size - 1, y1: t.y + 3 };
}
