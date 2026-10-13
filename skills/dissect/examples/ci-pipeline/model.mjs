// From commit to production: one change's trip through a small team's
// delivery pipeline, on a working day. The numbers are those of a team of
// about eight engineers with a fast test suite, one reviewer on duty and one
// deploy at a time (a deploy lock). CI and Ship are machines of their own:
// open them. Seed 10 is a day close to the median of fifteen seeds.

export default {
  id: "ci-pipeline",
  title: "From commit to production",
  item: "change",
  about: "A change goes through CI, then review, then a guarded deploy. Red builds and requested changes send it back to its author.",
  unit: "min",
  seed: 10,
  horizon: 480,
  lanes: [
    { id: "dev", label: "Author" },
    { id: "ci", label: "CI" },
    { id: "review", label: "Review" },
    { id: "prod", label: "Production" },
  ],
  parts: [
    { id: "commit", kind: "start", lane: "dev", at: [0, 0], label: "push", every: "exp 20", about: "An engineer pushes a change. Pushes arrive at random, about three an hour." },
    {
      id: "ci",
      kind: "station",
      lane: "ci",
      at: [1, 0],
      label: "CI",
      glyph: "test",
      about: "Checks out the change, then runs the unit tests, the linter and the build side by side. It is as slow as its slowest job.",
      inside: {
        lanes: [{ id: "runners", label: "" }],
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "queued" },
          { id: "setup", kind: "station", at: [1, 0], label: "Check out", glyph: "code", servers: 4, work: "logn 1 2.5", about: "One of four runners checks out the change and restores the dependency cache." },
          { id: "fan", kind: "split", at: [2, 0], label: "in parallel" },
          { id: "unit", kind: "station", at: [3, -1], label: "Unit tests", servers: 4, work: "logn 3 6", fail: 0.12, about: "About one run in eight finds a broken test." },
          { id: "lint", kind: "station", at: [3, 0], label: "Lint", servers: 4, work: "logn 1 2", fail: 0.05 },
          { id: "build", kind: "station", at: [3, 1], label: "Build", servers: 4, work: "logn 4 8", fail: 0.04 },
          { id: "all", kind: "join", at: [4, 0], label: "all done" },
          { id: "green", kind: "choice", at: [5, 0], label: "green?" },
          { id: "pass", kind: "end", at: [6, 0], label: "green" },
          { id: "red", kind: "end", at: [6, 1], label: "red" },
        ],
        routes: [
          { from: "in", to: "setup" },
          { from: "setup", to: "fan" },
          { from: "fan", to: "unit" },
          { from: "fan", to: "lint" },
          { from: "fan", to: "build" },
          { from: "unit", to: "all" },
          { from: "lint", to: "all" },
          { from: "build", to: "all" },
          { from: "all", to: "green" },
          { from: "green", to: "pass", when: "ok", label: "" },
          { from: "green", to: "red", when: "fail", label: "" },
        ],
      },
    },
    { id: "fix", kind: "station", lane: "dev", at: [1, 0], label: "Fix it", glyph: "code", servers: Infinity, work: "logn 15 45", about: "The author fixes what CI or the reviewers found. Everyone fixes their own change, so nothing waits here." },
    { id: "review", kind: "station", lane: "review", at: [2, 0], label: "Code review", servers: 1, work: "logn 12 30", fail: 0.15, failLabel: "changes requested", about: "The reviewer on duty reads one change at a time. A review takes 12 minutes at the median and half an hour on a bad day; 15% end with changes requested." },
    {
      id: "ship",
      kind: "station",
      lane: "prod",
      at: [3, 0],
      label: "Ship",
      glyph: "deploy",
      servers: 1,
      about: "One deploy at a time: merge, a canary on a few hosts, a few minutes of watching its metrics, then everywhere or back.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "lock taken" },
          { id: "merge", kind: "station", at: [1, 0], label: "Merge", servers: 1, work: "logn 1 3" },
          { id: "canary", kind: "station", at: [2, 0], label: "Canary 5%", glyph: "deploy", servers: 1, work: "uni 1 2" },
          { id: "bake", kind: "timer", at: [3, 0], label: "watch", wait: 4, about: "The canary serves real traffic while its error rate and latency are compared with the rest of the fleet." },
          { id: "healthy", kind: "choice", at: [4, 0], label: "healthy?" },
          { id: "promote", kind: "station", at: [5, 0], label: "Roll out", glyph: "deploy", servers: 1, work: "logn 3 6" },
          { id: "rollback", kind: "station", at: [5, 1], label: "Roll back", glyph: "wrench", servers: 1, work: "uni 2 4" },
          { id: "live", kind: "end", at: [6, 0], label: "live" },
          { id: "back", kind: "end", at: [6, 1], label: "rolled back", outcome: "fail" },
        ],
        routes: [
          { from: "in", to: "merge" },
          { from: "merge", to: "canary" },
          { from: "canary", to: "bake" },
          { from: "bake", to: "healthy" },
          { from: "healthy", to: "promote", p: 0.95 },
          { from: "healthy", to: "rollback", p: 0.05 },
          { from: "promote", to: "live" },
          { from: "rollback", to: "back" },
        ],
      },
    },
    { id: "live", kind: "end", lane: "prod", at: [4, 0], label: "in production" },
    { id: "rolled", kind: "end", lane: "prod", at: [4, 1], label: "rolled back" },
  ],
  // what the caption says, checked by the audit on the figure's seed and on seven more
  claims: [
    { metric: "review.waitShare", min: 0.2, say: "a large share of a change's time is waiting for the reviewer" },
    { metric: "review.utilization", min: 0.6, max: 0.92, say: "the reviewer is busy most of the day, and keeps up" },
    { metric: "lead.p50", min: 35, max: 80, say: "about an hour from push to production" },
  ],
  routes: [
    { from: "commit", to: "ci" },
    { from: "ci", to: "review", when: "ok", label: "green" },
    { from: "ci", to: "fix", when: "fail", label: "red" },
    { from: "fix", to: "ci" },
    { from: "review", to: "ship", when: "ok", label: "approved" },
    { id: "changes", from: "review", to: "fix", when: "fail", label: "changes" },
    { from: "ship", to: "live", when: "ok", label: "" },
    { from: "ship", to: "rolled", when: "fail", label: "" },
  ],
};

// The caption, written from the run: every number in it is generated.
export const figure = {
  fig: "Fig 1",
  caption: ({ run, day, variant, fmt }) => {
    const review = run.stations.review;
    const share = (review.meanWait * review.started) / (run.meanLead * run.done);
    const two = variant((m) => (m.parts.find((p) => p.id === "review").servers = 2)).stations.review;
    return `On this day a change takes ${fmt(run.p50Lead)} from push to production at the median, and over ${fmt(run.p95Lead)} for the slowest 5%. ${Math.round(share * 100)}% of that time is spent waiting for the reviewer, who is busy ${Math.round(day.stations.review.utilization * 100)}% of the day; a second reviewer cuts the wait from ${fmt(review.meanWait)} to ${fmt(two.meanWait)}. Click Code review and give it one more at a time.`;
  },
};
