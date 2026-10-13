// An ETL pipeline, over a day. Three sources feed it at their own rhythm: the
// orders database is extracted every hour, the event stream lands a
// micro-batch every 15 minutes, and a partner drops files whenever it does.
// Each batch is extracted, landed raw in object storage, transformed (schema
// check, cleaning and deduplication, a join with the dimension tables, the
// aggregates the dashboards read), loaded into the warehouse through two load
// slots, and checked before the dashboards may show it. A batch that fails its
// schema is quarantined whole; one that fails the quality checks is held for
// a person. The lesson is freshness: how long a fact takes from its source to
// a dashboard, and which step that time goes to: the join with the large
// dimension tables. Make it twice as fast and watch freshness improve.
// Numbers: a mid-size warehouse, batches of minutes of work, not hours.

export default {
  id: "etl",
  title: "A day of ETL, source to dashboard",
  item: "batch",
  about: "Extract from the sources, land the raw data, transform it, load it into the warehouse, check it, and only then let the dashboards show it.",
  unit: "min",
  seed: 3,
  horizon: 1440,
  lanes: [
    { id: "src", label: "Sources" },
    { id: "lake", label: "Lake" },
    { id: "wh", label: "Warehouse" },
  ],
  parts: [
    { id: "orders", kind: "start", lane: "src", at: [0, -1], label: "orders DB", every: 60, first: 5, classes: { orders: 1 }, about: "Every hour, the rows changed in the orders database since the last run." },
    { id: "events", kind: "start", lane: "src", at: [0, 0], label: "event stream", every: 15, classes: { events: 1 }, about: "Every 15 minutes, a micro-batch of clicks and app events from the stream." },
    { id: "files", kind: "start", lane: "src", at: [0, 1], label: "partner files", every: "exp 180", first: 40, classes: { partner: 1 }, about: "A partner uploads files a few times a day, when it suits them." },
    { id: "extract", kind: "station", lane: "src", at: [1, 0], label: "Extract", glyph: "db", servers: 3, work: "logn 3 9", about: "Three extract workers read each source with its own connector and credentials." },
    { id: "land", kind: "station", lane: "lake", at: [1, 0], label: "Land raw", glyph: "cloud", servers: "inf", work: "logn 1 3", uses: ["raw"], about: "The batch is written as it came, partitioned by source and hour, so any run can be replayed from here." },
    { id: "raw", kind: "store", lane: "lake", at: [1, 1], label: "raw files" },
    {
      id: "transform",
      kind: "station",
      lane: "lake",
      at: [2, 0],
      label: "Transform",
      glyph: "build",
      servers: 4,
      about: "Four transform jobs at once. A batch either comes out ready for the warehouse, or is quarantined whole when its schema is wrong.",
      inside: {
        lanes: [
          { id: "job", label: "Job" },
          { id: "ref", label: "Reference" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "job", at: [0, 0], label: "raw batch" },
          { id: "schema", kind: "station", lane: "job", at: [1, 0], label: "Schema check", glyph: "check", servers: "inf", work: "logn 0.5 1.5", fail: 0.02, failLabel: "wrong schema", about: "Columns, types and required fields as agreed with the source. A renamed column upstream fails here, not three steps later." },
          { id: "ok", kind: "choice", lane: "job", at: [2, 0], label: "valid?" },
          { id: "clean", kind: "station", lane: "job", at: [3, 0], label: "Clean, dedupe", glyph: "wrench", servers: "inf", work: "logn 3 8", about: "Trim, normalize time zones and currencies, drop the duplicates a retried extract produced." },
          { id: "join", kind: "station", lane: "job", at: [4, 0], label: "Join dimensions", glyph: "merge", servers: "inf", work: "logn 9 30", uses: ["dims"], about: "Attach customers, products and regions from the dimension tables: the slow step, because those tables are large." },
          { id: "agg", kind: "station", lane: "job", at: [5, 0], label: "Aggregate", glyph: "search", servers: "inf", work: "logn 2 6", about: "The daily and hourly totals the dashboards read." },
          { id: "ready", kind: "end", lane: "job", at: [6, 0], label: "ready" },
          { id: "bad", kind: "end", lane: "job", at: [3, 1], label: "quarantined", outcome: "fail" },
          { id: "dims", kind: "store", lane: "ref", at: [4, 0], label: "dimension tables" },
        ],
        routes: [
          { from: "in", to: "schema" },
          { from: "schema", to: "ok" },
          { id: "pass", from: "ok", to: "clean", when: "ok", label: "" },
          { id: "reject", from: "ok", to: "bad", when: "fail", label: "no" },
          { from: "clean", to: "join" },
          { from: "join", to: "agg" },
          { from: "agg", to: "ready" },
        ],
      },
    },
    { id: "quarantine", kind: "end", lane: "lake", at: [3, 1], label: "quarantined" },
    { id: "load", kind: "station", lane: "wh", at: [3, 0], label: "Load", glyph: "db", servers: 2, work: "logn 4 12", about: "Two load slots on the warehouse: an upsert into the fact tables, then the partitions are swapped in." },
    { id: "dq", kind: "station", lane: "wh", at: [4, 0], label: "Quality checks", glyph: "test", servers: "inf", work: "logn 1 4", fail: 0.03, failLabel: "checks failed", about: "Row counts against the source, totals against yesterday, no nulls where there must be none." },
    { id: "fresh", kind: "end", lane: "wh", at: [5, 0], label: "on the dashboards" },
    { id: "held", kind: "end", lane: "wh", at: [5, 1], label: "held for review" },
  ],
  routes: [
    { from: "orders", to: "extract" },
    { from: "events", to: "extract" },
    { from: "files", to: "extract" },
    { from: "extract", to: "land" },
    { from: "land", to: "transform" },
    { from: "transform", to: "load", when: "ok", label: "" },
    { id: "to-quarantine", from: "transform", to: "quarantine", when: "fail", label: "" },
    { from: "load", to: "dq" },
    { from: "dq", to: "fresh", when: "ok", label: "" },
    { id: "hold", from: "dq", to: "held", when: "fail", label: "" },
  ],
  claims: [
    { metric: "lead.p50", min: 20, max: 90, say: "a batch reaches the dashboards within the hour" },
    { metric: "load.utilization", min: 0.2, max: 0.85, say: "the load slots keep up over the day" },
  ],
};

export const figure = {
  fig: "Fig 13",
  caption: ({ run, sim, variant, fmt }) => {
    // where a batch's time goes, over every batch: the join's own work against the whole
    const join = sim.log.filter((r) => r.k === "start" && r.at === "transform/join").reduce((a, r) => a + (r.t1 - r.t), 0);
    const total = run.meanLead * run.done;
    const fast = variant((m) => (m.parts.find((p) => p.id === "transform").inside.parts.find((p) => p.id === "join").work = "logn 4.5 15"));
    const lost = (run.outcomes.fail || 0);
    return `A batch takes ${fmt(run.p50Lead)} from its source to the dashboards at the median, ${fmt(run.p95Lead)} for the slowest 5%, and ${Math.round((join / total) * 100)}% of all that time is one step: the join with the dimension tables. With that join twice as fast, the median would be ${fmt(fast.p50Lead)}. ${lost} of ${run.done} batches were quarantined or held for review instead. Open Transform, and try "Twice as fast" on Join dimensions.`;
  },
};
