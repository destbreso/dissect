import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, simulate } from "../skills/dissect/kit/sim.mjs";
import { validate } from "../skills/dissect/kit/model.mjs";
import { sampler, meanOf, checkDuration, describe } from "../skills/dissect/kit/dist.mjs";
import { splitmix32 } from "../skills/dissect/kit/rng.mjs";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b} (±${rel * 100}%)`);

const mm1 = (lambdaEvery, workMean, extra = {}) => ({
  id: "mm1",
  seed: 11,
  horizon: 40000,
  parts: [
    { id: "in", kind: "start", at: [0, 0], every: `exp ${lambdaEvery}` },
    { id: "desk", kind: "station", at: [1, 0], work: `exp ${workMean}`, ...extra },
    { id: "out", kind: "end", at: [2, 0] },
  ],
  routes: [
    { from: "in", to: "desk" },
    { from: "desk", to: "out" },
  ],
});

test("durations: means and shapes", () => {
  const r = splitmix32(3);
  for (const [spec, mean] of [["exp 4", 4], ["uni 2 6", 4], ["tri 1 2 6", 3], ["pick 1 2 3", 2], [5, 5]]) {
    const s = sampler(spec);
    let sum = 0;
    for (let i = 0; i < 40000; i++) sum += s(r);
    near(sum / 40000, mean, 0.03, `mean of ${spec}`);
    near(meanOf(spec), mean, 1e-9, `analytic mean of ${spec}`);
  }
  const s = sampler("logn 4 9");
  const xs = Array.from({ length: 40000 }, () => s(r)).sort((a, b) => a - b);
  near(xs[Math.floor(0.5 * xs.length)], 4, 0.03, "lognormal median");
  near(xs[Math.floor(0.95 * xs.length)], 9, 0.04, "lognormal p95");
  assert.match(checkDuration("logn 9 4"), /median < p95/);
  assert.match(checkDuration("wat 3"), /unknown duration/);
  assert.equal(checkDuration("exp 3"), null);
  assert.equal(describe("logn 4 9", "min"), "median 4 min, p95 9 min");
});

test("M/M/1 matches queueing theory (rho = 0.5: W = 2, utilization 0.5)", () => {
  const sim = simulate(mm1(2, 1), { warmup: 2000 });
  const s = sim.stats();
  near(s.steady.meanLead, 2, 0.06, "mean time in system");
  near(s.stations.desk.utilization, 0.5, 0.03, "utilization");
});

test("M/M/1 at rho = 0.8: W = 5, Little's law L = lambda W", () => {
  const sim = createSim(mm1(1.25, 1), { warmup: 2000 }).runUntil(40000);
  const s = sim.stats();
  near(s.steady.meanLead, 5, 0.1, "mean time in system");
  // L = lambda * W, with lambda the measured throughput
  near(s.wip, s.throughput * s.meanLead, 0.05, "Little's law");
});

test("deterministic: the same seed gives the same log", () => {
  const a = JSON.stringify(simulate(mm1(2, 1), { horizon: 500 }).log);
  const b = JSON.stringify(simulate(mm1(2, 1), { horizon: 500 }).log);
  assert.equal(a, b);
  const c = JSON.stringify(simulate(mm1(2, 1), { horizon: 500, seed: 99 }).log);
  assert.notEqual(a, c);
});

test("a change at t leaves the run before t untouched, and conserves items", () => {
  const base = simulate(mm1(2, 1), { horizon: 400 });
  const hit = simulate(mm1(2, 1), { horizon: 400, changes: [{ t: 150, part: "desk", set: { servers: 0 } }, { t: 220, part: "desk", set: { servers: 1 } }] });
  const before = (log) => JSON.stringify(log.filter((r) => r.t < 150));
  assert.equal(before(hit.log), before(base.log));
  const s = hit.stats();
  assert.equal(s.born, s.done, "everything that came in left");
  assert.ok(hit.log.some((r) => r.k === "change"));
  // the outage makes the queue longer than the calm run's
  assert.ok(s.stations.desk.maxQueue > base.stats().stations.desk.maxQueue);
});

test("split and join: the item waits for its slowest branch", () => {
  const sim = simulate({
    seed: 1,
    horizon: 1,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 100", count: 1 },
      { id: "fork", kind: "split", at: [1, 0] },
      { id: "fast", kind: "station", at: [2, -1], work: 3 },
      { id: "slow", kind: "station", at: [2, 1], work: 5 },
      { id: "meet", kind: "join", at: [3, 0] },
      { id: "out", kind: "end", at: [4, 0] },
    ],
    routes: [
      { from: "in", to: "fork" },
      { from: "fork", to: "fast" },
      { from: "fork", to: "slow" },
      { from: "fast", to: "meet" },
      { from: "slow", to: "meet" },
      { from: "meet", to: "out", latency: 1 },
    ],
  });
  const s = sim.stats();
  assert.equal(s.done, 1);
  near(s.meanLead, 6, 1e-9, "lead = slowest branch + the last hop");
  assert.ok(sim.log.some((r) => r.k === "split" && r.children.length === 2));
  assert.ok(sim.log.some((r) => r.k === "join"));
});

test("retry loop: max caps the attempts, then the fallback route", () => {
  const sim = simulate({
    seed: 2,
    horizon: 50,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 10" },
      { id: "build", kind: "station", at: [1, 0], work: 1, fail: 1 },
      { id: "green", kind: "choice", at: [2, 0] },
      { id: "ship", kind: "end", at: [3, 0] },
      { id: "give-up", kind: "end", at: [3, 1], outcome: "abandoned" },
    ],
    routes: [
      { from: "in", to: "build" },
      { from: "build", to: "green" },
      { from: "green", to: "ship", when: "ok" },
      { id: "retry", from: "green", to: "build", when: "fail", max: 2 },
      { from: "green", to: "give-up", when: "fail" },
    ],
  });
  const s = sim.stats();
  assert.equal(s.outcomes.abandoned, s.done);
  assert.equal(s.stations.build.finished, 3 * s.done, "one try plus two retries each");
});

test("a station's inside is its work: same tokens, consistent times", () => {
  const sim = simulate({
    seed: 4,
    horizon: 1,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 50", count: 1 },
      {
        id: "review",
        kind: "station",
        at: [1, 0],
        inside: {
          parts: [
            { id: "entry", kind: "start", at: [0, 0] },
            { id: "read", kind: "station", at: [1, 0], work: 2 },
            { id: "comment", kind: "station", at: [2, 0], work: 3 },
            { id: "leave", kind: "end", at: [3, 0] },
          ],
          routes: [
            { from: "entry", to: "read" },
            { from: "read", to: "comment" },
            { from: "comment", to: "leave" },
          ],
        },
      },
      { id: "out", kind: "end", at: [2, 0] },
    ],
    routes: [
      { from: "in", to: "review" },
      { from: "review", to: "out" },
    ],
  });
  const s = sim.stats();
  near(s.meanLead, 5, 1e-9, "lead = the inner process's time");
  assert.ok(sim.log.some((r) => r.k === "enter" && r.station === "review"));
  assert.ok(sim.log.some((r) => r.k === "start" && r.at === "review/read"));
  assert.ok(sim.log.some((r) => r.k === "exit" && r.station === "review"));
});

test("patience: items that wait too long leave with a timeout", () => {
  const sim = simulate({
    seed: 5,
    horizon: 100,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 1" },
      { id: "desk", kind: "station", at: [1, 0], work: 10, patience: 2 },
      { id: "after", kind: "choice", at: [2, 0] },
      { id: "served", kind: "end", at: [3, 0] },
      { id: "gave-up", kind: "end", at: [3, 1], outcome: "timeout" },
    ],
    routes: [
      { from: "in", to: "desk" },
      { from: "desk", to: "after" },
      { from: "after", to: "served", when: "ok" },
      { from: "after", to: "gave-up", when: "timeout" },
    ],
  });
  const s = sim.stats();
  assert.ok(s.stations.desk.timedOut > s.stations.desk.finished, "most give up");
  assert.equal(s.done, s.born);
});

test("validation explains what is wrong", () => {
  const bad = validate({
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "exp 2" },
      { id: "fork", kind: "split", at: [1, 0] },
      { id: "a", kind: "station", at: [2, 0], work: 1 },
      { id: "b", kind: "station", at: [2, 1], work: 1 },
      { id: "pick", kind: "choice", at: [3, 0] },
      { id: "out", kind: "end", at: [4, 0] },
      { id: "lost", kind: "station", at: [5, 0], work: 1 },
    ],
    routes: [
      { from: "in", to: "fork" },
      { from: "fork", to: "a" },
      { from: "fork", to: "b" },
      { from: "a", to: "pick" },
      { from: "b", to: "pick" },
      { from: "pick", to: "out", p: 0.5 },
      { from: "pick", to: "lost", p: 0.4 },
      { from: "lost", to: "out" },
    ],
  });
  const text = bad.errors.join("\n");
  assert.match(text, /add up to 0\.9/);
  const bad2 = validate({
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "exp 2" },
      { id: "fork", kind: "split", at: [1, 0] },
      { id: "a", kind: "station", at: [2, 0], work: 1 },
      { id: "b", kind: "station", at: [2, 1], work: 1 },
      { id: "out", kind: "end", at: [4, 0] },
    ],
    routes: [
      { from: "in", to: "fork" },
      { from: "fork", to: "a" },
      { from: "fork", to: "b" },
      { from: "a", to: "out" },
      { from: "b", to: "out" },
    ],
  });
  assert.match(bad2.errors.join("\n"), /never meet at one join/);
  const warn = validate(mm1(2, 1, { fail: 0.1 }));
  assert.match(warn.warnings.join("\n"), /no choice after it routes "fail"/);
});

test("a change can set a choice's odds from a moment on", () => {
  const def = {
    seed: 3,
    horizon: 4000,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 1" },
      { id: "hit", kind: "choice", at: [1, 0] },
      { id: "fast", kind: "end", at: [2, 0] },
      { id: "slow", kind: "end", at: [2, 1] },
    ],
    routes: [
      { from: "in", to: "hit" },
      { id: "yes", from: "hit", to: "fast", p: 0.9 },
      { id: "no", from: "hit", to: "slow", p: 0.1 },
    ],
  };
  const sim = simulate(def, { changes: [{ t: 2000, part: "hit", set: { p: { yes: 1, no: 3 } } }] });
  const after = sim.log.filter((r) => r.k === "decide" && r.t > 2000);
  const share = after.filter((r) => r.route.endsWith("::no")).length / after.length;
  near(share, 0.75, 0.06, "share of no after the change");
  const before = sim.log.filter((r) => r.k === "decide" && r.t < 2000);
  near(before.filter((r) => r.route.endsWith("::no")).length / before.length, 0.1, 0.25, "share of no before");
});

test("a change can set a start's class mix", () => {
  const def = {
    seed: 8,
    horizon: 3000,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "const 1", classes: { real: 1, noise: 1 } },
      { id: "out", kind: "end", at: [1, 0] },
    ],
    routes: [{ from: "in", to: "out" }],
  };
  const sim = simulate(def, { changes: [{ t: 1500, part: "in", set: { classes: { real: 1, noise: 0 } } }] });
  const born = sim.log.filter((r) => r.k === "born");
  const late = born.filter((r) => r.t > 1500);
  assert.ok(late.every((r) => r.cls === "real"), "after the change only real arrives");
  const early = born.filter((r) => r.t < 1500);
  near(early.filter((r) => r.cls === "noise").length / early.length, 0.5, 0.08, "before, half noise");
});

test("a fan-out sends one copy down every branch, each to its own end", () => {
  const def = {
    seed: 2,
    horizon: 100,
    parts: [
      { id: "pub", kind: "start", at: [0, 0], every: "const 10" },
      { id: "topic", kind: "split", at: [1, 0], fanout: true },
      { id: "a", kind: "station", at: [2, -1], work: 1 },
      { id: "b", kind: "station", at: [2, 1], work: 3 },
      { id: "doneA", kind: "end", at: [3, -1] },
      { id: "doneB", kind: "end", at: [3, 1] },
    ],
    routes: [
      { from: "pub", to: "topic" },
      { from: "topic", to: "a" },
      { from: "topic", to: "b" },
      { from: "a", to: "doneA" },
      { from: "b", to: "doneB" },
    ],
  };
  assert.deepEqual(validate(def).errors, []);
  const s = simulate(def).stats();
  assert.equal(s.done, 2 * s.born, "two deliveries per message");
  assert.equal(s.inSystem, 0);
  const bad = validate({ ...def, parts: [...def.parts.slice(0, 4), { id: "meet", kind: "join", at: [3, 0] }, { id: "out", kind: "end", at: [4, 0] }], routes: [...def.routes.slice(0, 3), { from: "a", to: "meet" }, { from: "b", to: "meet" }, { from: "meet", to: "out" }] });
  assert.match(bad.errors.join("\n"), /nothing would ever join them/);
});
