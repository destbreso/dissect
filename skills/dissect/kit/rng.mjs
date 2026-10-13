// Seeded randomness. Every figure is reproducible: the same seed gives the
// same arrivals, the same service times and the same branches, so a tour, a
// caption and a test all see the same run.

/** splitmix32: small, fast, good enough for simulation; returns floats in [0, 1). */
export function splitmix32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), to derive per-part streams from one seed. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * One independent stream per name (a part, a route, the arrivals of a start).
 * Changing one part's draws never shifts another part's: an injected outage
 * at one station leaves every other station's numbers where they were.
 */
export function streams(seed) {
  const cache = new Map();
  return function stream(name) {
    let s = cache.get(name);
    if (!s) {
      s = splitmix32((seed ^ hash32(name)) >>> 0);
      cache.set(name, s);
    }
    return s;
  };
}
