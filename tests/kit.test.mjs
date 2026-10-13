import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { normalize, validate } from "../skills/dissect/kit/model.mjs";
import { layout } from "../skills/dissect/kit/layout.mjs";
import { sheetSvg } from "../skills/dissect/kit/render.mjs";
import { simulate } from "../skills/dissect/kit/sim.mjs";
import { Replay, placeOf } from "../skills/dissect/kit/replay.mjs";
import { buildFigure, runtimeScript } from "../skills/dissect/kit/page.mjs";
import { audit, auditLayout } from "../skills/dissect/kit/audit.mjs";
import { formatDuration, short, scaleSpec } from "../skills/dissect/kit/dist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "dissect", "examples");

/** Every model shipped in the examples: model.mjs, and any other model module next to it. */
async function exampleModels() {
  const out = [];
  for (const name of readdirSync(ROOT)) {
    for (const file of ["model.mjs", "oauth.mjs"]) {
      const path = join(ROOT, name, file);
      if (!existsSync(path)) continue;
      const mod = await import(pathToFileURL(path).href);
      out.push({ name: `${name}/${file}`, def: mod.default });
    }
  }
  return out;
}

const levelsOf = (model) => {
  const out = [];
  (function walk(m) {
    out.push(m);
    for (const p of m.parts) if (p.inside) walk(p.inside);
  })(model);
  return out;
};

test("durations for people", () => {
  assert.equal(formatDuration(135, "min"), "2 h 15 min");
  assert.equal(formatDuration(2300, "ms"), "2.3 s");
  assert.equal(formatDuration(0.05, "ns"), "50 ps");
  assert.equal(formatDuration(1500, "ns"), "1.5 µs");
  assert.equal(short("logn 12 30", "min"), "12 min, p95 30");
  assert.equal(short(0.08, "ns"), "80 ps");
  assert.equal(scaleSpec("logn 20 60", 2), "logn 40 120");
});

test("every example model is valid", async () => {
  for (const { name, def } of await exampleModels()) {
    const { errors } = validate(def);
    assert.deepEqual(errors, [], name);
  }
});

test("layout: routes are orthogonal, start and end on their parts, and never cross a part", async () => {
  for (const { name, def } of await exampleModels()) {
    for (const lv of levelsOf(normalize(def))) {
      const L = layout(lv);
      for (const r of L.routes) {
        assert.ok(r.points.length >= 2, `${name} ${r.id} has points`);
        for (let i = 1; i < r.points.length; i++) {
          const [a, b] = [r.points[i - 1], r.points[i]];
          assert.ok(Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01, `${name} ${lv.path}::${r.id} segment ${i} is orthogonal`);
        }
      }
      const { errors } = auditLayout(lv, L);
      assert.deepEqual(errors, [], `${name} ${lv.path || "top"}`);
    }
  }
});

test("replay: counters match the simulator, nothing is left alive, every item has a place", async () => {
  for (const { name, def } of await exampleModels()) {
    const model = normalize(def);
    const sim = simulate(def);
    const s = sim.stats();
    const stations = new Map();
    const ends = [];
    for (const lv of levelsOf(model))
      for (const p of lv.parts) {
        if (p.kind === "station") stations.set(p.path, p.servers);
        if (p.kind === "end") ends.push(p.path);
      }
    const metas = {};
    for (const lv of levelsOf(model)) metas[lv.path] = sheetSvg(layout(lv), lv).meta;
    const R = new Replay(sim.log, { stations, ends });
    // half way, every live item on the top level has a place inside the sheet
    R.advance(def.horizon / 2);
    for (const id of R.alive) {
      const p = placeOf(R, R.tokens.get(id), metas, "", R.t);
      if (!p || p.dock || p.hidden) continue;
      assert.ok(p.x >= 0 && p.y >= 0 && p.x <= metas[""].width && p.y <= metas[""].height, `${name}: item ${id} drawn inside the sheet`);
    }
    R.advance(Infinity);
    assert.equal(R.alive.size, 0, `${name}: nothing alive at the end`);
    assert.equal(R.done, s.done, `${name}: done count`);
    for (const [path, st] of Object.entries(s.stations)) assert.equal(R.st.get(path).finished, st.finished, `${name}: ${path} finished`);
  }
});

test("the page: the inlined runtime parses and exposes mount and boot; the data round-trips", async () => {
  const src = runtimeScript();
  assert.doesNotThrow(() => new Function(src), "the runtime is valid script");
  assert.ok(!/^\s*(import|export)\b/m.test(src), "no module syntax left");
  const { def } = (await exampleModels()).find((m) => m.name.startsWith("ci-pipeline"));
  const fig = buildFigure(def, { fig: "Fig 1" });
  const json = fig.html.match(/<script type="application\/json" data-dissect="[^"]+">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.model.parts.find((p) => p.id === "fix").servers, "inf", "Infinity travels as inf");
  assert.equal(normalize(data.model).byId.get("fix").servers, Infinity);
  assert.ok(data.options.metas[""] && data.options.metas.ci && data.options.metas.ship, "geometry for every level");
});

test("the audit catches what a reader would", () => {
  const base = {
    seed: 1,
    horizon: 200,
    parts: [
      { id: "in", kind: "start", at: [0, 0], every: "exp 5" },
      { id: "a", kind: "station", at: [1, 0], work: "exp 3" },
      { id: "pick", kind: "choice", at: [2, 0] },
      { id: "out", kind: "end", at: [3, 0] },
      { id: "rare", kind: "end", at: [3, 1] },
    ],
    routes: [
      { from: "in", to: "a" },
      { from: "a", to: "pick" },
      { from: "pick", to: "out", p: 1 },
      { from: "pick", to: "rare", p: 0 },
    ],
    claims: [{ metric: "a.utilization", min: 0.9, say: "a is nearly always busy" }],
  };
  const r = audit(base);
  assert.match(r.errors.join("\n"), /claim \("a is nearly always busy"\)/);
  assert.match(r.warnings.join("\n"), /never taken/);
  const seldom = audit({ ...base, claims: [], routes: base.routes.map((x) => (x.to === "rare" ? { ...x, seldom: true } : x)) });
  assert.equal(seldom.errors.length, 0);
  assert.ok(!seldom.warnings.some((w) => /never taken/.test(w)));
  const overlap = audit({ ...base, claims: [], parts: base.parts.map((p) => (p.id === "rare" ? { ...p, at: [3, 0] } : p)) });
  assert.match(overlap.errors.join("\n"), /overlap/);
});

test("every example passes its audit", async () => {
  for (const { name, def } of await exampleModels()) {
    const r = audit(def);
    assert.deepEqual(r.errors, [], name);
    assert.deepEqual(r.warnings, [], name);
  }
});
