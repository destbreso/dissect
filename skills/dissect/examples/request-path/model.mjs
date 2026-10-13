// One request, from the browser to the database and back, in milliseconds. A
// CDN edge answers 40% of requests from its cache; the rest cross to the
// origin, where one of eight API workers handles each. Inside the API, Redis
// has the answer 85% of the time; the rest go to Postgres. The trip, not the work, is most of a request's time, and
// the cache is what keeps the database (and so the workers) free: make the
// misses more common and watch the workers fill, the queue grow and the 504s
// start. The latencies are those of a user on the same continent as the
// origin; the work times are those of a small, healthy service.

export default {
  id: "request-path",
  title: "One request, edge to database",
  item: "request",
  about: "A request crosses the internet to the nearest edge. The edge answers when it has the page cached; otherwise the request goes on to the origin, where an API worker asks Redis, and Postgres when Redis does not have it.",
  unit: "ms",
  seed: 4,
  horizon: 1200,
  lanes: [
    { id: "net", label: "Internet" },
    { id: "edge", label: "Edge" },
    { id: "origin", label: "Origin" },
  ],
  parts: [
    { id: "browser", kind: "start", lane: "net", at: [0, 0], every: "exp 1.5", about: "About 660 requests a second, from many browsers." },
    { id: "pop", kind: "station", lane: "edge", at: [1, 0], label: "Edge cache", glyph: "network", servers: "inf", work: "logn 0.5 2", about: "The CDN's nearest point of presence looks the page up in its cache." },
    { id: "fresh", kind: "choice", lane: "edge", at: [2, 0], label: "cached?" },
    { id: "edgehit", kind: "end", lane: "net", at: [3, 0], label: "from the edge" },
    { id: "lb", kind: "station", lane: "origin", at: [3, 0], label: "Load balancer", glyph: "balance", servers: "inf", work: 0.2 },
    {
      id: "api",
      kind: "station",
      lane: "origin",
      at: [4, 0],
      label: "API",
      glyph: "server",
      servers: 8,
      patience: 200,
      about: "Eight workers. A request waits for a free one; after 200 ms the load balancer gives up and answers 504.",
      inside: {
        lanes: [
          { id: "worker", label: "Worker" },
          { id: "data", label: "Data" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "worker", at: [0, 0], label: "a worker" },
          { id: "parse", kind: "station", lane: "worker", at: [1, 0], label: "Parse & auth", glyph: "key", servers: "inf", work: "logn 1 3" },
          { id: "redis", kind: "station", lane: "data", at: [2, 0], label: "Redis GET", glyph: "cache", servers: 1, work: "logn 0.15 0.5", about: "One thread, fast enough that it never makes anyone wait here." },
          { id: "hit", kind: "choice", lane: "data", at: [3, 0], label: "in Redis?" },
          { id: "pg", kind: "station", lane: "data", at: [4, 0], label: "Postgres", glyph: "db", servers: 2, work: "logn 12 50", about: "Two cores for this endpoint's queries. A query takes 12 ms at the median and 50 ms on a bad one." },
          { id: "render", kind: "station", lane: "worker", at: [4, 0], label: "Render", glyph: "doc", servers: "inf", work: "logn 1.5 4" },
          { id: "out", kind: "end", lane: "worker", at: [5, 0], label: "response" },
        ],
        routes: [
          { from: "in", to: "parse" },
          { from: "parse", to: "redis", latency: 0.4 },
          { from: "redis", to: "hit" },
          { id: "cache-hit", from: "hit", to: "render", p: 0.85, label: "hit", latency: 0.4 },
          { id: "miss", from: "hit", to: "pg", p: 0.15, label: "miss", latency: 0.4 },
          { from: "pg", to: "render", latency: 0.4 },
          { from: "render", to: "out" },
        ],
      },
    },
    { id: "ok", kind: "end", lane: "net", at: [5, 0], label: "200 OK" },
    { id: "timeout", kind: "end", lane: "net", at: [5, 1], label: "504" },
  ],
  routes: [
    { from: "browser", to: "pop", latency: "uni 12 30" },
    { from: "pop", to: "fresh" },
    { id: "edge-hit", from: "fresh", to: "edgehit", p: 0.4, label: "hit", latency: "uni 12 30" },
    { id: "edge-miss", from: "fresh", to: "lb", p: 0.6, label: "miss", latency: "uni 15 40" },
    { from: "lb", to: "api" },
    { from: "api", to: "ok", when: "ok", label: "", latency: "uni 27 70" },
    { from: "api", to: "timeout", when: "timeout", label: "", latency: "uni 27 70", seldom: true },
  ],
  claims: [
    { metric: "lead.p50", min: 40, max: 120, say: "a request takes well under a tenth of a second" },
    { metric: "api.utilization", max: 0.5, say: "the workers have room to spare while the cache holds" },
  ],
};

export const figure = {
  fig: "Fig 2",
  caption: ({ run, sim, variant, fmt }) => {
    // the trip: time spent on the top level's routes (the network), against the whole
    const trip = sim.log.filter((r) => r.k === "move" && r.route.startsWith("::")).reduce((a, r) => a + (r.t1 - r.t), 0);
    const lead = run.meanLead * run.done;
    const cold = variant((m) => {
      const inner = m.parts.find((p) => p.id === "api").inside;
      inner.routes.find((r) => r.id === "cache-hit").p = 0.4;
      inner.routes.find((r) => r.id === "miss").p = 0.6;
    });
    const share504 = (cold.outcomes.timeout || 0) / Math.max(1, cold.done);
    const after = share504 >= 0.01 ? `the median goes to ${fmt(cold.p50Lead)}, p95 to ${fmt(cold.p95Lead)}, and ${Math.round(share504 * 100)}% of requests end in a 504` : `the median only moves to ${fmt(cold.p50Lead)} and p95 to ${fmt(cold.p95Lead)}`;
    return `A request takes ${fmt(run.p50Lead)} at the median and ${fmt(run.p95Lead)} at p95, and ${Math.round((trip / lead) * 100)}% of that is the trip across the network; the work at the origin is a few milliseconds. With Redis missing 60% of the time instead of 15%, ${after}. Open the API and make the misses more common to watch the workers fill.`;
  },
};
