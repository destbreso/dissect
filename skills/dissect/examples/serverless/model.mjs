// A checkout on serverless. API Gateway hands each request to the checkout
// function, which has a reserved concurrency of 10: an eleventh request at the
// same moment is turned away with a 429, because a synchronous call has nowhere
// to wait. Most invocations land on a warm container; about 7% need a new one
// and pay a cold start. The function writes the order, answers the client, and
// leaves a message on a queue: the fulfilment function reads it, six at a time,
// and calls the warehouse, retrying with a backoff when the warehouse fails.
// Two lessons: cold starts make the slow tail, and the queue absorbs a burst
// that the synchronous path can only refuse. Try a burst on "checkout".
// Numbers: about 40 checkouts a second, a 45 ms handler, cold starts of half a
// second, a warehouse API at 80 ms median that fails 3% of the time.

export default {
  id: "serverless",
  title: "A checkout on serverless",
  item: "request",
  about: "Synchronous where the shopper waits, asynchronous where nobody does: the checkout function answers right away and leaves the fulfilment to a queue and a second function.",
  unit: "ms",
  seed: 6,
  horizon: 5000,
  lanes: [
    { id: "client", label: "Shopper" },
    { id: "api", label: "API" },
    { id: "fn", label: "Functions" },
    { id: "async", label: "Async" },
  ],
  parts: [
    { id: "shoppers", kind: "start", lane: "client", at: [0, 0], label: "checkout", every: "exp 25", about: "About 40 checkouts a second." },
    { id: "gateway", kind: "station", lane: "api", at: [1, 0], label: "API Gateway", glyph: "gate", servers: "inf", work: "logn 3 8", about: "Authorizes the call and invokes the function synchronously: the shopper's request waits for its answer." },
    {
      id: "checkout",
      kind: "station",
      lane: "fn",
      at: [2, 0],
      label: "checkout fn",
      glyph: "robot",
      servers: 10,
      capacity: 0,
      about: "Ten instances at most (its reserved concurrency). A request that finds all ten busy is refused at once with a 429.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "invoked" },
          { id: "warm", kind: "choice", at: [1, 0], label: "warm container?" },
          { id: "cold", kind: "station", at: [2, 1], label: "Cold start", glyph: "build", servers: "inf", work: "logn 450 1100", about: "No idle container: download the code, start the runtime, run the module's init. Half a second at the median." },
          { id: "handler", kind: "station", at: [3, 0], label: "Handler", glyph: "code", servers: "inf", work: "logn 45 120", uses: ["orders"], about: "Validates the cart, writes the order, puts a message on the queue." },
          { id: "orders", kind: "store", at: [3, 1], label: "orders table" },
          { id: "done", kind: "end", at: [4, 0], label: "returns" },
        ],
        routes: [
          { from: "in", to: "warm" },
          { id: "warm-hit", from: "warm", to: "handler", p: 0.93, label: "warm" },
          { id: "cold-start", from: "warm", to: "cold", p: 0.07, label: "cold" },
          { from: "cold", to: "handler" },
          { from: "handler", to: "done" },
        ],
      },
    },
    { id: "throttled", kind: "end", lane: "client", at: [3, 0], label: "429 throttled" },
    { id: "fan", kind: "split", lane: "fn", at: [3, 0], label: "answer, then queue", fanout: true, about: "Two things happen at once: the answer goes back to the shopper, and the order goes on through the queue." },
    { id: "created", kind: "end", lane: "client", at: [4, 0], label: "201 Created" },
    { id: "fulfil", kind: "station", lane: "async", at: [4, 0], label: "fulfil fn", glyph: "truck", servers: 6, work: "logn 80 250", fail: 0.03, failLabel: "warehouse errors", about: "Reads the queue six messages at a time (its concurrency) and calls the warehouse API." },
    { id: "backoff", kind: "timer", lane: "async", at: [4, 1], label: "back off", wait: "uni 150 300" },
    { id: "shipped", kind: "end", lane: "async", at: [5, 0], label: "at the warehouse" },
    { id: "dlq", kind: "end", lane: "async", at: [5, 1], label: "dead letters", outcome: "fail" },
  ],
  routes: [
    { from: "shoppers", to: "gateway", latency: "uni 20 40" },
    { from: "gateway", to: "checkout" },
    { from: "checkout", to: "fan", when: "ok", label: "" },
    { id: "refused", from: "checkout", to: "throttled", when: "rejected", label: "all 10 busy", latency: "uni 20 40" },
    { from: "fan", to: "created", latency: "uni 20 40" },
    { id: "enqueue", from: "fan", to: "fulfil", latency: "uni 5 15", label: "queue" },
    { from: "fulfil", to: "shipped", when: "ok", label: "" },
    { id: "retry", from: "fulfil", to: "backoff", when: "fail", max: 2, label: "retry ≤2" },
    { id: "give-up", from: "fulfil", to: "dlq", when: "fail", label: "3rd failure", seldom: true },
    { from: "backoff", to: "fulfil" },
  ],
  claims: [
    { metric: "checkout.utilization", min: 0.15, max: 0.6, say: "the function's ten slots have room on an ordinary second" },
    { metric: "fulfil.utilization", min: 0.4, max: 0.9, say: "fulfilment keeps up with the queue" },
  ],
};

export const figure = {
  fig: "Fig 5",
  pace: 25,
  caption: ({ run, sim, variant, fmt }) => {
    const leadsAt = (s, end) => {
      const born = new Map();
      const out = [];
      for (const r of s.log) {
        if (r.k === "born") born.set(r.tok, r.t);
        if (r.k === "done" && r.at === end) out.push(r.t - born.get(r.tok.split(".")[0]));
      }
      return out.sort((a, b) => a - b);
    };
    const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    const answers = leadsAt(sim, "created");
    const invoked = sim.log.filter((r) => r.k === "enter" && r.station === "checkout").length;
    const colds = sim.log.filter((r) => r.k === "start" && r.at === "checkout/cold").length;
    const refused = (log, t0 = -Infinity, t1 = Infinity) => log.filter((r) => r.k === "reject" && r.t >= t0 && r.t <= t1).length;
    // the same day with a burst: three times the traffic for a third of a second
    const t0 = 800;
    const t1 = 1133;
    const burst = variant(null, { changes: [{ t: t0, part: "shoppers", set: { every: "exp 8.333" } }, { t: t1, part: "shoppers", set: { every: "exp 25" } }] });
    const queued = burst.stations.fulfil.maxQueue;
    return `A shopper gets an answer in ${fmt(q(answers, 0.5))} at the median and ${fmt(q(answers, 0.99))} at p99: the slow tail is the ${Math.round((colds / invoked) * 100)}% of invocations that paid a cold start. On this ordinary stretch ${refused(sim.log)} of ${invoked + refused(sim.log)} requests found all ten instances busy and got a 429. With three times the traffic for ${fmt(t1 - t0)}, ${refused(burst.log, t0, t1 + 200)} requests are refused in that moment, while behind the function the queue only grows (to ${queued} waiting) and then drains. Give "checkout" a burst and watch both.`;
  },
};
