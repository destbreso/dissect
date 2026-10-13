// Durations and intervals. A model says how long things take the way people
// measure them: a constant, a range, an average with exponential spread, or a
// median with a p95 (the most natural way to state a real service time).
//
// Accepted forms (number = constant):
//   3                      constant 3
//   "const 3"              constant 3
//   "uni 2 5"              uniform between 2 and 5
//   "exp 4"                exponential with mean 4 (memoryless arrivals, M/M/c)
//   "norm 10 2"            normal, mean 10, sd 2, clipped at 0
//   "logn 4 9"             lognormal with median 4 and p95 9 (long right tail)
//   "tri 1 2 6"            triangular: min 1, most likely 2, max 6
//   "pick 1 2 2 3"         one of the listed values, equally likely
// Objects work too: { exp: 4 }, { logn: [4, 9] }, { uni: [2, 5] }, ...

const Z95 = 1.6448536269514722;

function parse(spec) {
  if (typeof spec === "number") return { kind: "const", args: [spec] };
  if (typeof spec === "string") {
    const parts = spec.trim().split(/\s+/);
    const kind = parts[0];
    const args = parts.slice(1).map(Number);
    return { kind, args };
  }
  if (spec && typeof spec === "object") {
    const [kind] = Object.keys(spec);
    const v = spec[kind];
    return { kind, args: Array.isArray(v) ? v.map(Number) : [Number(v)] };
  }
  throw new Error(`dissect: cannot read the duration ${JSON.stringify(spec)}`);
}

const KINDS = {
  const: { n: 1, mean: ([v]) => v, sample: ([v]) => v },
  uni: { n: 2, mean: ([a, b]) => (a + b) / 2, sample: ([a, b], r) => a + (b - a) * r() },
  exp: { n: 1, mean: ([m]) => m, sample: ([m], r) => -m * Math.log(1 - r()) },
  norm: {
    n: 2,
    mean: ([m]) => m,
    sample: ([m, sd], r) => Math.max(0, m + sd * gauss(r)),
  },
  logn: {
    n: 2,
    mean: ([median, p95]) => {
      const sigma = Math.log(p95 / median) / Z95;
      return median * Math.exp((sigma * sigma) / 2);
    },
    sample: ([median, p95], r) => {
      const sigma = Math.log(p95 / median) / Z95;
      return median * Math.exp(sigma * gauss(r));
    },
  },
  tri: {
    n: 3,
    mean: ([a, c, b]) => (a + b + c) / 3,
    sample: ([a, c, b], r) => {
      const u = r();
      const f = (c - a) / (b - a || 1);
      return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
    },
  },
  pick: {
    n: -1,
    mean: (vs) => vs.reduce((s, v) => s + v, 0) / vs.length,
    sample: (vs, r) => vs[Math.min(vs.length - 1, Math.floor(r() * vs.length))],
  },
};

function gauss(r) {
  let u = r();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Validate a duration spec; returns an error string, or null when it is fine. */
export function checkDuration(spec) {
  let p;
  try {
    p = parse(spec);
  } catch (e) {
    return e.message;
  }
  const k = KINDS[p.kind];
  if (!k) return `unknown duration kind "${p.kind}" (use const, uni, exp, norm, logn, tri or pick)`;
  if (k.n > 0 && p.args.length !== k.n) return `"${p.kind}" takes ${k.n} number(s), got ${p.args.length}`;
  if (p.args.some((v) => !Number.isFinite(v))) return `"${p.kind}" has a value that is not a number`;
  if (p.args.some((v) => v < 0)) return `"${p.kind}" has a negative value`;
  if (p.kind === "logn" && !(p.args[1] > p.args[0] && p.args[0] > 0)) return `"logn median p95" needs 0 < median < p95`;
  if (p.kind === "uni" && p.args[1] < p.args[0]) return `"uni a b" needs a <= b`;
  if (p.kind === "tri" && !(p.args[0] <= p.args[1] && p.args[1] <= p.args[2])) return `"tri min mode max" needs min <= mode <= max`;
  if (p.kind === "pick" && p.args.length === 0) return `"pick" needs at least one value`;
  return null;
}

/** A sampler for a spec: (rng) => duration. Throws on a bad spec. */
export function sampler(spec) {
  const err = checkDuration(spec);
  if (err) throw new Error(`dissect: ${err}`);
  const p = parse(spec);
  const k = KINDS[p.kind];
  return (rng) => k.sample(p.args, rng);
}

/** The analytical mean of a spec (used by the audit and by captions). */
export function meanOf(spec) {
  const p = parse(spec);
  return KINDS[p.kind].mean(p.args);
}

// A time too small for its unit reads in the next one down: 0.002 s is 2 ms,
// 0.5 min is 30 s, 0.3 ns is 300 ps. Seconds and their fractions keep one
// decimal place (0.3 s); minutes, hours, days and nanoseconds step down below 1.
const BELOW = { s: [1e3, "ms"], ms: [1e3, "µs"], us: [1e3, "ns"], "µs": [1e3, "ns"], ns: [1e3, "ps"], min: [60, "s"], h: [60, "min"], d: [24, "h"] };
const floorOf = (unit) => (unit === "s" || unit === "ms" || unit === "us" || unit === "µs" ? 0.1 : 1);
/** The unit some times read best in, and what to multiply them by. */
function downUnit(values, unit) {
  let k = 1;
  let u = unit;
  while (BELOW[u] && values.some((v) => v !== 0) && values.every((v) => Math.abs(v * k) < floorOf(u))) {
    k *= BELOW[u][0];
    u = BELOW[u][1];
  }
  return { k, unit: u };
}

// a time per kind of item, kinds first and the rest ("else") last
const perKind = (spec, fn, sep) =>
  Object.entries(spec)
    .sort(([a], [b]) => (a === "else") - (b === "else"))
    .map(([k, v]) => `${k === "else" ? "others" : k} ${fn(v)}`)
    .join(sep);

/** A short human description, e.g. "median 4, p95 9" or "about 6 on average"; per kind, "cpu median 5 ms; others 0.2 ms". */
export function describe(spec, unit = "") {
  if (spec != null && typeof spec === "object") return perKind(spec, (v) => describe(v, unit), "; ");
  const p0 = parse(spec);
  const d = downUnit(p0.args, unit);
  const p = { ...p0, args: p0.args.map((v) => v * d.k) };
  unit = d.unit;
  const u = unit ? ` ${p.kind === "const" ? one(p.args[0], unit) : unit}` : "";
  const f = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
  switch (p.kind) {
    case "const":
      return `${f(p.args[0])}${u}`;
    case "uni":
      return `${f(p.args[0])} to ${f(p.args[1])}${u}`;
    case "exp":
      return `${f(p.args[0])}${u} on average`;
    case "norm":
      return `${f(p.args[0])}${u} ± ${f(p.args[1])}`;
    case "logn":
      return `median ${f(p.args[0])}${u}, p95 ${f(p.args[1])}${u}`;
    case "tri":
      return `${f(p.args[0])} to ${f(p.args[2])}${u}, usually ${f(p.args[1])}`;
    case "pick":
      return `one of ${p.args.map(f).join(", ")}${u}`;
    default:
      return String(spec);
  }
}

const num = (v) => {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)).replace(/0+$/, "").replace(/\.$/, "");
};

// a unit of your own reads in the singular for exactly one ("1 cycle", "2 cycles")
const one = (v, unit) => (v === 1 && unit && !LADDERS[unit] && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit);

/** A label short enough for a plate: "4 min, p95 9", "2-6 min", "~4 min". */
export function short(spec, unit = "") {
  if (spec != null && typeof spec === "object") return perKind(spec, (v) => short(v, unit), ", ");
  const p = parse(spec);
  const d = downUnit(p.args, unit);
  unit = d.unit;
  const u = unit ? ` ${p.kind === "const" ? one(p.args[0], unit) : unit}` : "";
  const a = p.args.map((v) => v * d.k);
  switch (p.kind) {
    case "const":
      return `${num(a[0])}${u}`;
    case "uni":
      return `${num(a[0])}-${num(a[1])}${u}`;
    case "exp":
      return `~${num(a[0])}${u}`;
    case "norm":
      return `${num(a[0])}±${num(a[1])}${u}`;
    case "logn":
      return `${num(a[0])}${u}, p95 ${num(a[1])}`;
    case "tri":
      return `${num(a[0])}-${num(a[2])}${u}`;
    case "pick":
      return a.length === 1 ? `${num(a[0])}${u}` : `${num(Math.min(...a))}-${num(Math.max(...a))}${u}`;
    default:
      return String(spec);
  }
}

// Unit ladders: each step is [size in the base unit, suffix].
const LADDERS = {
  ns: [[1, "ns"], [1000, "µs"], [1e6, "ms"], [1e9, "s"]],
  us: [[1, "µs"], [1000, "ms"], [1e6, "s"]],
  "µs": [[1, "µs"], [1000, "ms"], [1e6, "s"]],
  ms: [[1, "ms"], [1000, "s"], [60000, "min"]],
  s: [[1, "s"], [60, "min"], [3600, "h"], [86400, "d"]],
  min: [[1, "min"], [60, "h"], [1440, "d"]],
  h: [[1, "h"], [24, "d"]],
  d: [[1, "d"], [7, "wk"]],
};

/**
 * An amount of model time for people: 42 -> "42 min", 135 -> "2 h 15 min",
 * 0.4 (unit s) -> "0.4 s". Unknown units print as "12.5 tickets".
 */
export function formatDuration(v, unit = "") {
  if (!Number.isFinite(v)) return "-";
  const d = downUnit([v], unit);
  v *= d.k;
  unit = d.unit;
  // picoseconds are the smallest step: whole ones
  if (unit === "ps") return `${Math.round(v)} ps`;
  const ladder = LADDERS[unit];
  if (!ladder) {
    const r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return `${num(r)}${unit ? ` ${one(r, unit)}` : ""}`;
  }
  let i = 0;
  while (i + 1 < ladder.length && Math.abs(v) >= ladder[i + 1][0]) i++;
  const [size, name] = ladder[i];
  const x = v / size;
  const [, lower] = ladder[Math.max(0, i - 1)];
  // below ten of a big unit, two parts read best ("2 h 15 min"); small units read as decimals ("2.3 s")
  if (i === 0 || x >= 10 || lower === "ms" || lower === "ns" || lower === "µs") return `${num(x < 10 ? Math.round(x * 10) / 10 : Math.round(x))} ${name}`;
  const whole = Math.floor(x);
  const rest = Math.round((v - whole * size) / ladder[i - 1][0]);
  if (rest === 0) return `${whole} ${name}`;
  if (rest * ladder[i - 1][0] >= size) return `${whole + 1} ${name}`;
  return `${whole} ${name} ${rest} ${lower}`;
}

/** The same distribution stretched by k (k = 2: everything takes twice as long); a time per kind stretches each. */
export function scaleSpec(spec, k) {
  if (spec != null && typeof spec === "object") return Object.fromEntries(Object.entries(spec).map(([c, v]) => [c, scaleSpec(v, k)]));
  const p = parse(spec);
  const a = p.args.map((v) => Math.round(v * k * 1e6) / 1e6);
  if (p.kind === "const") return a[0];
  return `${p.kind} ${a.join(" ")}`;
}

/** A count for a plate or a readout: 940, 9.4k, 94k, 9.4M. */
export function compact(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1e6) return `${Math.round(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * How often a start sends work, in the words under it: "every ~20 min", or,
 * when one dot stands for many real items, how many arrive per unit ("~10k/s").
 */
export function rateWords(every, unit, per = 1) {
  if (per > 1) {
    const m = meanOf(every);
    return m > 0 ? `~${compact(per / m)}/${unit || "unit"}` : "";
  }
  return `every ${short(every, unit)}`;
}
