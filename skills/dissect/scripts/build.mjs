#!/usr/bin/env node
// Build a page from a model file.
//
//   node build.mjs <model.mjs | model.json> [options]
//
// A model module exports the model as default, and may export `figure`:
//   { fig, title, hint, caption }  where caption is a string or a function
//   (ctx) => string that writes it from the run, so every number in it is
//   generated: ctx = { run, day, sim, variant, fmt, model }
//     run      stats of the whole run (every item followed to its end)
//     sim      that run itself, with its log
//     day      stats at the horizon (busy shares over the working period)
//     variant  (edit, { changes }) => stats (and .log) of a run of a copy of the
//              model after edit(copy), with timed changes like the page's what-ifs
//     fmt      a duration in the model's unit, for people
//
// Options:
//   --out <file>     where to write (default: next to the model, <id>.html)
//   --light, --dark  fix the theme (default: follows the reader's setting)
//   --audit          run the audit first; stop on errors
//   --strict         with --audit, stop on warnings too
//   --check          then check the page in headless Chrome (check.mjs): words,
//                    rails, tags and contrast measured on every level, light and
//                    dark, desktop and phone; stop on errors. Read its pictures.
//   --embed          write a fragment (figure, styles, script) to paste into a page

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writePage, embed } from "../kit/page.mjs";
import { auditOrExit } from "../kit/audit.mjs";
import { simulate, createSim } from "../kit/sim.mjs";
import { formatDuration } from "../kit/dist.mjs";

export async function load(file) {
  const path = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
  if (path.endsWith(".json")) return { def: JSON.parse(readFileSync(path, "utf8")), figure: {}, path };
  const mod = await import(pathToFileURL(path).href);
  if (!mod.default) throw new Error(`${path} has no default export (the model)`);
  return { def: mod.default, figure: mod.figure || {}, path };
}

/** The context a caption function writes from. */
export function captionContext(def) {
  const sim = simulate(def);
  const run = sim.stats();
  const day = createSim(def).runUntil(def.horizon ?? 600).stats();
  const variant = (edit, opts = {}) => {
    const copy = structuredClone(def);
    if (edit) edit(copy);
    const v = simulate(copy, opts);
    const st = v.stats();
    st.log = v.log;
    return st;
  };
  return { run, day, sim, variant, fmt: (v) => formatDuration(v, def.unit), model: def };
}

export async function buildFile(file, argv = []) {
  const { def, figure, path } = await load(file);
  const flag = (f) => argv.includes(f);
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  if (flag("--audit")) auditOrExit(def, { strict: flag("--strict") });
  const theme = flag("--light") ? "light" : flag("--dark") ? "dark" : "auto";
  const caption = typeof figure.caption === "function" ? figure.caption(captionContext(def)) : figure.caption;
  const opts = { fig: figure.fig, title: figure.title, hint: figure.hint, caption, theme, pace: figure.pace, outage: figure.outage, burst: figure.burst, levelPace: figure.levelPace, speed: figure.speed, autoplay: figure.autoplay, idle: figure.idle, watch: figure.watch, head: figure.head, embedHeight: figure.embedHeight, pageTitle: figure.pageTitle };
  const stem = basename(path).replace(/\.(m?js|json)$/, "") === "model" ? def.id || "figure" : basename(path).replace(/\.(m?js|json)$/, "");
  if (flag("--embed")) {
    const out = resolve(opt("--out") ?? join(dirname(path), `${stem}.fragment.html`));
    const e = embed(def, opts);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${e.styles}\n${e.html}\n${e.script}\n`);
    console.log(`wrote ${out}`);
    return out;
  }
  const out = resolve(opt("--out") ?? join(dirname(path), `${stem}${theme === "auto" ? "" : `-${theme}`}.html`));
  const r = writePage(def, out, opts);
  console.log(`wrote ${r.path} (${Math.round(r.bytes / 1024)} kB, ${r.levels.map((l) => `${l.path || "top"} ${l.width}x${l.height}`).join(", ")})`);
  for (const w of r.warnings) console.log(`warning  ${w}`);
  if (caption) console.log(`caption  ${caption}`);
  if (flag("--check")) checkPage(out);
  return out;
}

/** Run check.mjs on a built page; exit when it fails. */
export function checkPage(page) {
  const script = join(dirname(fileURLToPath(import.meta.url)), "check.mjs");
  const shots = join(dirname(page), "shots", basename(page).replace(/\.html$/, ""));
  const r = spawnSync(process.execPath, [script, page, "--out", shots], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--out"));
  if (!file || args.includes("--help")) {
    console.log(readFileSync(self, "utf8").split("\n").slice(1, 24).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(file ? 0 : 1);
  }
  await buildFile(file, args);
}
