// Plane geometry shared by the layout, the drawing and the live page: polylines,
// rounded orthogonal paths, and the segment tests the router and the audit use.

const EPS = 0.01;

/** Drop repeated points and the middle point of any straight run. */
export function dedupe(points) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > EPS || Math.abs(q[1] - p[1]) > EPS) out.push(p);
  }
  if (out.length < 3) return out;
  const clean = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = clean[clean.length - 1];
    const b = out[i];
    const c = out[i + 1];
    const vertical = Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS;
    const horizontal = Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS;
    if (!vertical && !horizontal) clean.push(b);
  }
  clean.push(out[out.length - 1]);
  return clean;
}

const f = (v) => (Math.round(v * 2) / 2).toString();

/** Round a polyline's corners into an SVG path (quadratic corners of `radius`). */
export function roundedPath(points, radius) {
  const pts = dedupe(points);
  if (pts.length < 2) return "";
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = cx - ((cx - px) / l1) * r;
    const ay = cy - ((cy - py) / l1) * r;
    const bx = cx + ((nx - cx) / l2) * r;
    const by = cy + ((ny - cy) / l2) * r;
    d += ` L${f(ax)} ${f(ay)} Q${f(cx)} ${f(cy)} ${f(bx)} ${f(by)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last[0])} ${f(last[1])}`;
}

export function lengthOf(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return L;
}

/** Point at distance s along a polyline: [x, y, direction in radians]. */
export function along(points, s) {
  let left = s;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (left <= l || i === points.length - 1) {
      const u = l ? Math.min(1, Math.max(0, left / l)) : 0;
      return [ax + (bx - ax) * u, ay + (by - ay) * u, Math.atan2(by - ay, bx - ax)];
    }
    left -= l;
  }
  const p = points[points.length - 1];
  return [p[0], p[1], 0];
}

/** The first `s` of a polyline, as a polyline (for trails and partial glides). */
export function slice(points, s0, s1) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lo = acc;
    const hi = acc + l;
    if (hi >= s0 && lo <= s1 && l > 0) {
      const u0 = Math.max(0, (s0 - lo) / l);
      const u1 = Math.min(1, (s1 - lo) / l);
      const p0 = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0];
      const p1 = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
      if (!out.length) out.push(p0);
      out.push(p1);
    }
    acc = hi;
  }
  return out;
}

/** Segments of a polyline: [[x1, y1, x2, y2], ...]. */
export function segmentsOf(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]]);
  return out;
}

/** Does an axis-aligned segment pass through the inside of a rect {x0, y0, x1, y1}? */
export function segHitsRect(s, r) {
  const [x1, y1, x2, y2] = s;
  const lx = Math.min(x1, x2);
  const hx = Math.max(x1, x2);
  const ly = Math.min(y1, y2);
  const hy = Math.max(y1, y2);
  return hx > r.x0 && lx < r.x1 && hy > r.y0 && ly < r.y1;
}

/** Length over which two axis-aligned segments lie on top of each other (0 if they don't). */
export function overlapLength(s, t, tol = 2) {
  const sv = Math.abs(s[0] - s[2]) < EPS;
  const tv = Math.abs(t[0] - t[2]) < EPS;
  const sh = Math.abs(s[1] - s[3]) < EPS;
  const th = Math.abs(t[1] - t[3]) < EPS;
  if (sv && tv && Math.abs(s[0] - t[0]) <= tol) {
    const lo = Math.max(Math.min(s[1], s[3]), Math.min(t[1], t[3]));
    const hi = Math.min(Math.max(s[1], s[3]), Math.max(t[1], t[3]));
    return Math.max(0, hi - lo);
  }
  if (sh && th && Math.abs(s[1] - t[1]) <= tol) {
    const lo = Math.max(Math.min(s[0], s[2]), Math.min(t[0], t[2]));
    const hi = Math.min(Math.max(s[0], s[2]), Math.max(t[0], t[2]));
    return Math.max(0, hi - lo);
  }
  return 0;
}

/** Do a horizontal and a vertical segment cross strictly inside both? */
export function crosses(s, t) {
  const sv = Math.abs(s[0] - s[2]) < EPS;
  const tv = Math.abs(t[0] - t[2]) < EPS;
  if (sv === tv) return false;
  const [v, h] = sv ? [s, t] : [t, s];
  const x = v[0];
  const y = h[1];
  const inH = x > Math.min(h[0], h[2]) + 1 && x < Math.max(h[0], h[2]) - 1;
  const inV = y > Math.min(v[1], v[3]) + 1 && y < Math.max(v[1], v[3]) - 1;
  return inH && inV;
}

/** Do two rects {x0, y0, x1, y1} overlap (with an optional margin)? */
export function rectsOverlap(a, b, margin = 0) {
  return a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
}

export const rectOf = (box, inflate = 0) => ({ x0: box.x - box.w / 2 - inflate, y0: box.y - box.h / 2 - inflate, x1: box.x + box.w / 2 + inflate, y1: box.y + box.h / 2 + inflate });
