import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, simulate } from "../skills/dissect/kit/sim.mjs";
import { validate, normalize } from "../skills/dissect/kit/model.mjs";
import { Replay } from "../skills/dissect/kit/replay.mjs";
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

// ---- kinds of items, switches, dials, autoscaling ----------------------------------------------
const edge = (extra = {}) => ({
  id: "edge",
  seed: 5,
  horizon: 400,
  parts: [
    { id: "people", kind: "start", at: [0, 0], every: "exp 1", classes: { people: 1 } },
    { id: "bots", kind: "start", at: [0, 1], every: "exp 0.25", classes: { bots: 1 } },
    { id: "waf", kind: "station", at: [1, 0], servers: "inf", work: 0.001, fail: { bots: 0.6, people: 0.02 }, switch: true, ...extra.waf },
    { id: "cache", kind: "choice", at: [2, 0], switch: true },
    { id: "hit", kind: "end", at: [3, 1] },
    { id: "app", kind: "station", at: [3, 0], servers: 2, work: "exp 0.4", ...extra.app },
    { id: "served", kind: "end", at: [4, 0] },
    { id: "blocked", kind: "end", at: [2, 1], outcome: "fail" },
  ],
  routes: [
    { from: "people", to: "waf" },
    { from: "bots", to: "waf" },
    { from: "waf", to: "cache", when: "ok" },
    { from: "waf", to: "blocked", when: "fail" },
    { id: "h", from: "cache", to: "hit", p: { people: 0.7, bots: 0 } },
    { id: "m", from: "cache", to: "app", p: { people: 0.3, bots: 1 }, bypass: true },
    { from: "app", to: "served" },
  ],
});

test("chances by kind: a station fails, and a choice decides, with each kind's own odds", () => {
  const st = simulate(edge(), { seed: 5 }).stats();
  const P = st.kinds.people;
  const B = st.kinds.bots;
  near((B.ends.blocked ?? 0) / B.done, 0.6, 0.06, "bots blocked");
  near((P.ends.blocked ?? 0) / P.done, 0.02, 0.6, "people blocked");
  near((P.ends.hit ?? 0) / (P.done - (P.ends.blocked ?? 0)), 0.7, 0.08, "people served by the cache");
  assert.equal(B.ends.hit ?? 0, 0, "no bot is ever in the cache");
});

test("a switch: off from a moment on, a station lets everything through and a choice takes its bypass", () => {
  const def = edge();
  const base = createSim(def);
  base.runToEnd();
  const off = createSim(def, { changes: [{ t: 100, part: "waf", set: { bypass: true } }, { t: 100, part: "cache", set: { take: "m" } }] });
  off.runToEnd();
  const i = base.log.findIndex((r) => r.t >= 100);
  assert.deepEqual(off.log.slice(0, i), base.log.slice(0, i), "the run before the switch is the same");
  const after = off.log.filter((r) => r.t > 100.01);
  assert.ok(after.some((r) => r.k === "pass" && r.at === "waf"), "items pass the WAF while it is off");
  assert.ok(!after.some((r) => r.k === "start" && r.at === "waf"), "and none is worked on there");
  const blockedLate = after.filter((r) => r.k === "done" && r.at === "blocked").length;
  assert.equal(blockedLate, 0, "nothing is blocked while it is off");
  assert.ok(!after.some((r) => r.k === "decide" && r.route === "::h"), "the cache sends nothing to its hits while it is off");
});

test("a paused start sends nothing until it is let go", () => {
  const sim = createSim(edge(), { changes: [{ t: 50, part: "bots", set: { paused: true } }, { t: 150, part: "bots", set: { paused: false } }] });
  sim.runToEnd();
  const botsBorn = sim.log.filter((r) => r.k === "born" && r.at === "bots").map((r) => r.t);
  assert.ok(!botsBorn.some((t) => t > 50 && t < 150), "no bot between the pause and the release");
  assert.ok(botsBorn.some((t) => t > 150), "bots again after the release");
});

test("autoscaling: servers follow the load, are ready only after their boot, and stay within min and max", () => {
  const def = edge({ app: { scale: { min: 2, max: 9, target: 0.6, every: 10, boot: 30, cooldown: 40 } } });
  // a heavier load from t = 100 to 250, then back
  const sim = createSim(def, { changes: [{ t: 100, part: "bots", set: { every: "exp 0.08" } }, { t: 250, part: "bots", set: { every: "exp 0.25" } }] });
  sim.runToEnd();
  const scale = sim.log.filter((r) => r.k === "scale");
  assert.ok(scale.length, "it scales");
  for (const r of scale) assert.ok(r.servers >= 2 && r.servers + r.booting <= 9, `servers ${r.servers} (+${r.booting} starting) within 2 and 9 at ${r.t}`);
  const asked = scale.find((r) => r.booting > 0 && r.t >= 100);
  const ready = scale.find((r) => r.t > asked.t && r.servers > asked.servers);
  assert.ok(ready.t - asked.t >= 30 - 1e-9, "a server is ready no sooner than its boot");
  const peak = Math.max(...scale.map((r) => r.servers));
  assert.ok(peak > 2, "the load brings more servers");
  assert.ok(scale.at(-1).servers < peak, "and fewer once it has passed");
  const off = createSim(def, { changes: [{ t: 0, part: "app", set: { scale: false } }] });
  off.runToEnd();
  assert.ok(!off.log.some((r) => r.k === "scale" && r.servers !== 2), "with autoscaling off the servers stay as they are");
});

test("a run starts from the model's own switches and dials", () => {
  const def = edge();
  def.parts[2].switch = { on: false };
  def.parts[1].dials = [{ label: "Attack", value: 0, options: [{ label: "none", set: { paused: true } }, { label: "on" }] }];
  const sim = createSim(def);
  sim.runToEnd();
  assert.ok(!sim.log.some((r) => r.k === "born" && r.at === "bots"), "the attack dial starts at none");
  assert.ok(!sim.log.some((r) => r.k === "start" && r.at === "waf"), "the WAF starts off");
});

test("validation: chances by kind, switches, dials and scales explain what is wrong", () => {
  const msgs = (f) => validate(f(edge())).errors.join("\n");
  assert.match(msgs((d) => ((d.routes[4].p = { people: 0.6, bots: 0 }), d)), /for people, the p of its routes add up to 0\.9/);
  assert.match(msgs((d) => ((d.routes[5].bypass = false), d)), /mark the one route it sends everything down when it is off with bypass: true/);
  assert.match(msgs((d) => ((d.parts[0].switch = true), d)), /only a station or a choice can be turned off/);
  assert.match(msgs((d) => ((d.parts[5].dials = [{ label: "Speed", options: [{ label: "a" }, { label: "b", set: { wait: 2 } }] }]), d)), /sets wait on station "app"/);
  assert.match(msgs((d) => ((d.parts[5].scale = { min: 3, max: 8 }), d)), /starts with 2 servers, outside its scale/);
  assert.match(msgs((d) => ((d.parts[2].fail = { bots: 1.5 }), d)), /fail is a probability/);
});

// ---- closed starts, work by kind, emitting routes -------------------------------------------
const run = (extra = {}) => ({
  id: "run",
  seed: 4,
  horizon: 110,
  unit: "s",
  parts: [
    { id: "vus", kind: "start", at: [0, 0], vus: [[30, 20], [60, 20], [20, 0]], think: "uni 0.5 2", classes: { fast: 3, slow: 2, cpu: 1 }, ...extra.vus },
    { id: "loop", kind: "station", at: [1, 0], servers: 1, work: { cpu: "const 0.05", else: "const 0.001" }, ...extra.loop },
    { id: "which", kind: "choice", at: [2, 0] },
    { id: "timer", kind: "timer", at: [3, 1], wait: "uni 0.5 2.5", ...extra.timer },
    { id: "check", kind: "choice", at: [4, 0] },
    { id: "ok", kind: "end", at: [5, 0] },
    { id: "bad", kind: "end", at: [5, 1], outcome: "fail" },
    { id: "push", kind: "timer", at: [5, 2], wait: "uni 0 1" },
    { id: "panel", kind: "end", at: [6, 2] },
  ],
  routes: [
    { from: "vus", to: "loop" },
    { from: "loop", to: "which" },
    { from: "which", to: "timer", when: "class:slow" },
    { from: "which", to: "check", when: "else" },
    { from: "timer", to: "check" },
    { from: "check", to: "ok", when: "ok" },
    { from: "check", to: "bad", when: "fail" },
    { from: "check", to: "push", emit: "sample" },
    { from: "push", to: "panel" },
  ],
});

test("a closed start ramps virtual users the way k6's stages do, each starting its next item after its pause", () => {
  const sim = simulate(run());
  const vus = sim.log.filter((r) => r.k === "vus");
  assert.equal(Math.max(...vus.map((r) => r.n)), 20, "20 at the peak");
  near(vus[0].t, 1.5, 1e-9, "the first one starts as the target reaches one");
  assert.equal(vus.at(-1).n, 0, "none left at the end");
  assert.ok(vus.at(-1).t > 90 && vus.at(-1).t <= 112, `they leave during the ramp down (${vus.at(-1).t})`);
  const born = sim.log.filter((r) => r.k === "born" && r.at === "vus");
  for (const r of vus) assert.ok(r.n >= 0 && r.n <= 20);
  // in the steady minute, each user turns over once every pause plus answer
  const steady = born.filter((r) => r.t > 35 && r.t < 85).length / 50;
  const meanAnswer = (2 / 6) * 1.5 + 0.01;
  near(steady, 20 / (1.25 + meanAnswer), 0.12, "items a second in the steady minute");
  assert.equal(sim.stats().inSystem, 0, "every item ends");
});

test("a closed load answers slowness with fewer items a second, never a longer queue than its users", () => {
  const fast = simulate(run()).stats();
  const slowSim = simulate(run({ timer: { wait: "uni 3 5" } }));
  const slow = slowSim.stats();
  const items = (st) => Object.entries(st.kinds).filter(([k]) => k !== "sample").reduce((a, [, K]) => a + K.done, 0);
  assert.ok(items(slow) < items(fast) * 0.8, `fewer items when the answers are slower (${items(slow)} vs ${items(fast)})`);
  assert.ok(slow.stations.loop.maxQueue <= 20, "the queue never holds more than the users");
});

test("work by kind: one server, a slow kind holds it, and the others wait behind it", () => {
  const busy = simulate(run({ vus: { vus: [[5, 60], [60, 60], [5, 0]], think: "const 0.05", classes: { fast: 1, cpu: 1 } }, loop: { work: { cpu: "const 0.05", else: "const 0.001" } } })).stats();
  const calm = simulate(run({ vus: { vus: [[5, 60], [60, 60], [5, 0]], think: "const 0.05", classes: { fast: 1, cpu: 1 } }, loop: { work: { cpu: "const 0.001", else: "const 0.001" } } })).stats();
  assert.ok(busy.stations.loop.meanWait > 20 * calm.stations.loop.meanWait + 0.005, `fast items wait behind cpu ones (${busy.stations.loop.meanWait} vs ${calm.stations.loop.meanWait})`);
  near(busy.stations.loop.meanWork, (0.05 + 0.001) / 2, 0.15, "the work is each kind's own");
});

test("an emitting route sends a new item of its kind for every item that passes, and the item keeps its way", () => {
  const sim = simulate(run());
  const st = sim.stats();
  const passed = sim.log.filter((r) => r.k === "decide" && r.at === "check").length;
  assert.equal(st.kinds.sample.done, passed, "one sample per item checked");
  const emitted = sim.log.filter((r) => r.k === "born" && r.from);
  assert.equal(emitted.length, passed);
  assert.ok(emitted.every((r) => r.cls === "sample" && r.at === "check"), "of the emitted kind, born where they were sent");
  assert.equal(st.kinds.sample.ends.panel, passed, "and each reaches its own end");
  assert.equal(st.ends.bad ?? 0, 0, "the item's own outcome decides its way (none failed here)");
});

/** A top-level model's run, replayed to its end. */
const replayOf = (def) => {
  const m = normalize(def);
  const stations = new Map(m.parts.filter((p) => p.kind === "station").map((p) => [p.path, p.servers]));
  return new Replay(simulate(def).log, { stations, ends: m.parts.filter((p) => p.kind === "end").map((p) => p.path) }).advance(Infinity);
};

test("an item and its copies of its own kind share one root, so a breakdown counts the item once at each end", () => {
  // the samples go on to a dashboard server that also sends each one, as a sample, to a second end
  const def = run();
  def.parts = def.parts.filter((p) => p.id !== "panel").concat([
    { id: "dash", kind: "station", at: [6, 2], servers: "inf", work: "const 0.01" },
    { id: "lab", kind: "end", at: [7, 2] },
    { id: "yours", kind: "end", at: [7, 3] },
  ]);
  def.routes = def.routes.filter((r) => r.to !== "panel").concat([
    { from: "push", to: "dash" },
    { from: "dash", to: "lab" },
    { from: "dash", to: "yours", emit: "sample" },
  ]);
  const R = replayOf(def);
  const samples = R.finished.filter((f) => f.cls === "sample");
  const rootsAt = (end) => new Set(samples.filter((f) => f.at === end).map((f) => f.root));
  const lab = rootsAt("lab");
  assert.ok(lab.size > 100, `samples reach the lab's end (${lab.size})`);
  assert.equal(samples.length, lab.size * 2, "every sample reaches both ends");
  assert.deepEqual([...rootsAt("yours")].sort(), [...lab].sort(), "each copy has its sample's root");
  // a new item of another kind starts a family of its own
  const requests = new Set(R.finished.filter((f) => f.cls !== "sample").map((f) => f.root));
  assert.ok([...lab].every((r) => !requests.has(r)), "a sample is not counted as its request");
  // a fan-out's copies share the original's root
  const F = replayOf({
    id: "fan",
    seed: 2,
    horizon: 50,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "exp 1" },
      { id: "fan", kind: "split", at: [1, 0], fanout: true },
      { id: "a", kind: "end", at: [2, 0] },
      { id: "b", kind: "end", at: [2, 1] },
    ],
    routes: [
      { from: "in", to: "fan" },
      { from: "fan", to: "a" },
      { from: "fan", to: "b" },
    ],
  });
  assert.ok(F.finished.length > 20);
  assert.equal(F.finished.length, new Set(F.finished.map((f) => f.root)).size * 2, "two copies per item, one root");
});

test("validation: closed starts, work by kind and emitting routes explain what is wrong", () => {
  const msgs = (f) => validate(f(run())).errors.join("\n");
  assert.match(msgs((d) => ((d.parts[0].every = 1), d)), /has both every and vus/);
  assert.match(msgs((d) => ((d.parts[0].vus = [[30, 2.5]]), d)), /vus are stages/);
  assert.match(msgs((d) => ((d.parts[1].work = { cpu: "logn 5" }), d)), /work:/);
  assert.match(msgs((d) => ((d.routes[7].when = "ok"), d)), /emits, so it takes no when/);
  assert.match(
    msgs((d) => {
      d.routes.push({ id: "x", from: "vus", to: "panel", emit: "s" });
      return d;
    }),
    /only a station or a choice can send/,
  );
});

test("late:<time> routes the items that have taken that long or more since they started", () => {
  const def = run();
  def.routes.splice(5, 0, { id: "late", from: "check", to: "bad", when: "late:2" });
  const sim = simulate(def);
  const born = new Map(sim.log.filter((r) => r.k === "born").map((r) => [r.tok, r.t]));
  const late = sim.log.filter((r) => r.k === "decide" && r.route === "::late");
  assert.ok(late.length > 0, "some slow ones are late");
  for (const r of late) assert.ok(r.t - born.get(r.tok) >= 2 - 1e-9, "every one taken has taken 2 or more");
  const onTime = sim.log.filter((r) => r.k === "decide" && r.route === "::check>ok");
  for (const r of onTime) assert.ok(r.t - born.get(r.tok) < 2, "and none of the others has");
});
