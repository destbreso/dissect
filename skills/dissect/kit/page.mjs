// Pages. Builds a figure from a model: every level laid out and drawn, the
// geometry the live page needs, the model itself, and the runtime inlined as
// one classic script, so the page works from a file, offline, with no build
// step and no network. Node only (it reads the kit's own sources).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, kindsOf } from "./model.mjs";
import { layout } from "./layout.mjs";
import { sheetSvg, cardHtml, pageHtml, esc, css } from "./render.mjs";

const KIT = dirname(fileURLToPath(import.meta.url));
const RUNTIME = ["rng", "dist", "geom", "model", "sim", "replay", "live"];

/**
 * The kit modules the live page needs, as one script. Each module keeps its
 * own scope; imports between them become lookups in a small table. The kit is
 * written so this works: single-line `import { a, b } from "./x.mjs"` and
 * `export function|const|class` only.
 */
export function runtimeScript() {
  let out = "(()=>{\"use strict\";const __dx={};\n";
  for (const name of RUNTIME) {
    let src = readFileSync(join(KIT, `${name}.mjs`), "utf8");
    const names = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*"\.\/([\w-]+)\.mjs";?[ \t]*$/gm, (_, list, from) => {
      if (!RUNTIME.includes(from)) throw new Error(`page.mjs: ${name}.mjs imports ${from}.mjs, which is not part of the runtime`);
      return `const {${list.replace(/\s+as\s+/g, ": ")}} = __dx[${JSON.stringify(from)}];`;
    });
    src = src.replace(/^export\s+((?:async\s+)?function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, id) => {
      names.push(id);
      return `${kw} ${id}`;
    });
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`page.mjs: ${name}.mjs uses an import or export form the inliner does not handle`);
    out += `__dx[${JSON.stringify(name)}]=(()=>{${src}\nreturn {${names.join(",")}};})();\n`;
  }
  out += `window.dissect=__dx.live;if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__dx.live.boot);else __dx.live.boot();})();`;
  return out;
}

const toJson = (v) => JSON.stringify(v, (k, x) => (x === Infinity ? "inf" : x)).replace(/</g, "\\u003c");

/** Every level of a model, top first: [{ path, model }]. */
function levelsOf(model) {
  const out = [];
  (function walk(m) {
    out.push(m);
    for (const p of m.parts) if (p.inside) walk(p.inside);
  })(model);
  return out;
}

/**
 * Build one figure. Options:
 *   id, fig ("Fig 1"), title, caption, hint, theme ("auto" | "light" | "dark"),
 *   pace (model time per second at 1x; chosen from the run when left out),
 *   speed, autoplay, idle, outage, burst, levelPace, watch, layout (overrides for the floor plan)
 * Returns { html, data, warnings, levels: [{ path, width, height }] }.
 */
export function buildFigure(def, opts = {}) {
  const { errors, warnings, model } = validate(def);
  if (errors.length) throw new Error(`dissect: the model has problems:\n- ${errors.join("\n- ")}`);
  const id = opts.id || `dx-${model.id}`;
  const metas = {};
  const sheets = [];
  const levels = [];
  levelsOf(model).forEach((lv, i) => {
    const L = layout(lv, opts.layout);
    const name = lv.path ? `${lv.path.split("/").map((p) => model.byId.get(p)?.label ?? p).pop()}` : model.title || "process";
    const { svg, meta } = sheetSvg(L, lv, { uid: `${id}-${i}`, label: lv.path ? `Inside ${name}` : name });
    metas[lv.path] = meta;
    sheets.push(i === 0 ? svg : svg.replace("<svg ", '<svg class="dx-off" '));
    levels.push({ path: lv.path, width: L.width, height: L.height, layout: L });
  });
  // every kind of item, the emitted ones too, in the order the page colors them
  const classes = kindsOf(model);
  const legend = [];
  if (classes.length > 1) classes.forEach((c, i) => legend.push({ color: `var(--dx-c${i % 6})`, text: c }));
  const anyFail = [...levels].some((l) => l.layout.routes.some((r) => r.when && r.when !== "ok" && r.when !== "else" && !String(r.when).startsWith("class:")));
  if (opts.legend !== false && (legend.length || anyFail)) {
    if (!legend.length) legend.push({ color: "var(--dx-c0)", text: `a${/^[aeiou]/i.test(def.item || "item") ? "n" : ""} ${def.item || "item"}` });
    if (anyFail) legend.push({ color: "var(--dx-bad)", text: "came out failed" });
    legend.push({ color: "var(--dx-accent)", text: "the one you follow" });
  }
  const html = cardHtml({
    id,
    fig: opts.fig ?? "Fig 1",
    title: opts.title ?? model.title,
    sheets,
    hint: opts.hint ?? "Click a step to read it, open the ones with a window, click a dot to follow it.",
    caption: opts.caption ?? "",
    legend,
    theme: opts.theme ?? "auto",
  });
  const options = { metas, pace: opts.pace, speed: opts.speed, autoplay: opts.autoplay, idle: opts.idle, outage: opts.outage, burst: opts.burst, levelPace: opts.levelPace, hint: opts.hint, watch: opts.watch };
  const data = `<script type="application/json" data-dissect="${esc(id)}">${toJson({ model: def, options })}</script>`;
  return { html: `${html}\n${data}`, data, warnings, levels: levels.map(({ path, width, height }) => ({ path, width, height })), model };
}

/** A whole standalone page with one figure (or several: pass `figures`). */
export function standalonePage(def, opts = {}) {
  const figs = (opts.figures || [{ def, opts }]).map((f) => buildFigure(f.def, { ...opts, ...f.opts }));
  const intro = opts.intro ? `<main class="dx-page">${opts.intro}</main>` : "";
  const body = `${intro}${figs.map((f) => f.html).join('\n<div style="height:32px"></div>\n')}${opts.outro ? `<main class="dx-page">${opts.outro}</main>` : ""}`;
  // embedded in an iframe, the page tells the page around it how tall it is, so the frame can fit it
  const embed = opts.embedHeight
    ? `<script>(function(){if(window.parent===window)return;var last=0;function post(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;window.parent.postMessage({type:"dissect:height",height:h},"*")}}addEventListener("load",post);if(window.ResizeObserver)new ResizeObserver(post).observe(document.documentElement);})();</script>`
    : "";
  const head = `<style>.dx-page{max-width:760px;margin:0 auto 28px;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Liberation Sans",system-ui,sans-serif;color:#1d1c1a}.dx-page h1{font-size:28px;line-height:1.2;margin:8px 0 12px}@media (prefers-color-scheme:dark){.dx-page{color:#eceae4}}</style>${embed}${opts.head || ""}`;
  return {
    html: pageHtml({ title: opts.pageTitle ?? opts.title ?? figs[0].model.title ?? "dissect", body, script: runtimeScript(), theme: opts.theme ?? "auto", lang: opts.lang ?? "en", head }),
    figures: figs,
  };
}

/** Write a standalone page. Returns { path, bytes, warnings }. */
export function writePage(def, path, opts = {}) {
  const { html, figures } = standalonePage(def, opts);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return { path, bytes: Buffer.byteLength(html), warnings: figures.flatMap((f) => f.warnings), levels: figures.flatMap((f) => f.levels) };
}

/**
 * A fragment to drop into an existing page: the figure, its styles and the
 * runtime. Put `styles` once in the <head> (or before the first figure) and
 * `script` once after the last figure.
 */
export function embed(def, opts = {}) {
  const fig = buildFigure(def, opts);
  return { html: fig.html, styles: `<style>${css()}</style>`, script: `<script>${runtimeScript()}</script>`, warnings: fig.warnings };
}
