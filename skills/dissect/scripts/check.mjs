#!/usr/bin/env node
// The visual check: what the audit can only estimate, measured in a real
// browser on the built page. For every figure on the page, every level of it,
// in light and dark, on a desktop and on a phone:
//   - words inside a plate stay inside it; words outside a plate sit clear of
//     every other part, every other word, every tag and every rail
//   - every word has enough contrast with what is behind it (WCAG AA)
//   - the page never scrolls sideways (the drawing may scroll inside its card)
//   - the figure runs: it plays, a dot can be followed, a what-if applies,
//     and the console stays clean
// It writes a PNG of every level it looked at; read them. Exit 1 on any error.
//
//   node check.mjs <page.html> [--out shots/] [--strict]

import { needsWebSocketFlag, open, sleep } from "./chrome.mjs";
import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const HELP = `Check a built page in headless Chrome: layout measured in the browser, contrast, overflow, a short drive.

  node check.mjs <page.html> [--out <dir>] [--strict]

  --out <dir>   where the level PNGs go (default: shots/<page name>/)
  --strict      notes count as errors too`;

// Runs in the page: measures the visible level of one figure.
const MEASURE = `(() => {
  const out = { errors: [], notes: [] };
  const rgb = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const fig = document.querySelector(FIG);
  const svg = fig.querySelector(".dx-stage > svg:not(.dx-off)");
  const level = svg.getAttribute("data-level") || "top";
  const sheet = rgb(getComputedStyle(fig.querySelector(".dx-view")).backgroundColor);
  // boxes in the sheet's own coordinates, through each element's transform (lane labels are rotated)
  const toSheet = svg.getScreenCTM().inverse();
  const box = (el) => {
    const b = el.getBBox();
    const m = toSheet.multiply(el.getScreenCTM());
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const hit = (a, b, m = 0) => a.x0 < b.x1 - m && b.x0 < a.x1 - m && a.y0 < b.y1 - m && b.y0 < a.y1 - m;
  const name = (el) => (el.closest(".dx-part")?.getAttribute("data-path") || "the sheet");
  const say = (t) => (t.textContent || "").trim();
  const parts = [...svg.querySelectorAll(".dx-part")].map((g) => {
    const shape = g.querySelector(".dx-plate, .dx-event, .dx-store-body");
    return { g, path: g.getAttribute("data-path"), body: shape ? box(shape) : box(g), plate: g.querySelector(".dx-plate") && g.classList.contains("dx-station") };
  });
  const texts = [...svg.querySelectorAll("text")].filter((t) => say(t) && getComputedStyle(t).opacity !== "0" && !t.closest(".dx-tokens"));
  const tags = [...svg.querySelectorAll(".dx-tag rect")].map((r) => ({ el: r, b: box(r), text: say(r.parentNode) }));
  // rails: sample the route paths
  const rails = [];
  for (const p of svg.querySelectorAll(".dx-route .dx-rail")) {
    const L = p.getTotalLength();
    for (let s = 0; s <= L; s += 3) { const q = p.getPointAtLength(s); rails.push({ x: q.x, y: q.y, key: p.parentNode.getAttribute("data-key") }); }
  }
  for (const t of texts) {
    const b = box(t);
    const owner = t.closest(".dx-part");
    const inTag = t.closest(".dx-tag");
    const words = say(t);
    if (owner && owner.classList.contains("dx-station") && !t.classList.contains("dx-under")) {
      const plate = box(owner.querySelector(".dx-plate"));
      if (b.x0 < plate.x0 + 2 || b.x1 > plate.x1 - 2 || b.y0 < plate.y0 || b.y1 > plate.y1) out.errors.push(level + ": '" + words + "' runs out of the plate of " + name(t));
    } else if (!inTag) {
      for (const p of parts) if (p.g !== owner && hit(b, p.body, 1)) out.errors.push(level + ": the words '" + words + "' of " + name(t) + " sit on " + p.path);
      for (const r of rails) if (r.x > b.x0 + 1 && r.x < b.x1 - 1 && r.y > b.y0 + 1 && r.y < b.y1 - 1) { out.errors.push(level + ": a rail (" + r.key + ") runs over '" + words + "'"); break; }
      for (const g of tags) if (hit(b, g.b, 1)) out.errors.push(level + ": the tag '" + g.text + "' covers '" + words + "'");
    }
    // contrast with what is behind it
    const fill = rgb(getComputedStyle(t).fill);
    let under = sheet;
    if (inTag) under = rgb(getComputedStyle(inTag.querySelector("rect")).fill) || sheet;
    else if (owner && owner.classList.contains("dx-station") && !t.classList.contains("dx-under")) under = rgb(getComputedStyle(owner.querySelector(".dx-plate")).fill) || sheet;
    else if (owner && owner.classList.contains("dx-end") && t.classList.contains("dx-done")) under = rgb(getComputedStyle(owner.querySelector(".dx-event")).fill) || sheet;
    if (fill && under) {
      const c = ratio(mix(fill, under), under);
      const size = parseFloat(getComputedStyle(t).fontSize);
      const need = size >= 18 ? 3 : 4.5;
      if (c < need) out.errors.push(level + ": '" + words + "' has a contrast of " + c.toFixed(2) + ":1 (needs " + need + ")");
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.closest(".dx-tag") || b.closest(".dx-tag")) continue;
    if (hit(box(a), box(b), 1)) out.errors.push(level + ": '" + say(a) + "' and '" + say(b) + "' overlap");
  }
  for (let i = 0; i < tags.length; i++) {
    for (const p of parts) if (hit(tags[i].b, p.body, 1)) out.errors.push(level + ": the tag '" + tags[i].text + "' covers " + p.path);
    for (let j = i + 1; j < tags.length; j++) if (hit(tags[i].b, tags[j].b, 1)) out.errors.push(level + ": the tags '" + tags[i].text + "' and '" + tags[j].text + "' overlap");
  }
  // the card's own words: footer, dock, inspector, caption
  for (const el of fig.querySelectorAll(".dx-hint, .dx-readout, .dx-inspector p, .dx-inspector dt, .dx-inspector dd, .dx-caption, .dx-legend span, .dx-key, .dx-seg button, .dx-path button")) {
    const cs = getComputedStyle(el);
    if (!el.textContent.trim() || cs.visibility === "hidden" || cs.display === "none") continue;
    const fg = rgb(cs.color);
    let n = el, bg = null;
    while (n && n !== document.documentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) { bg = c; break; } n = n.parentElement; }
    bg = bg || rgb(getComputedStyle(document.body).backgroundColor);
    if (fg && bg) { const c = ratio(mix(fg, bg), bg); if (c < 4.5) out.errors.push(level + ": '" + el.textContent.trim().slice(0, 40) + "' in the card has a contrast of " + c.toFixed(2) + ":1"); }
  }
  const stage = fig.querySelector(".dx-stage");
  if (stage.scrollWidth > stage.clientWidth + 1) out.notes.push(level + ": the drawing scrolls sideways inside its card (" + stage.scrollWidth + " px in " + stage.clientWidth + ")");
  return out;
})()`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) {
    console.log(HELP);
    process.exit(argv.length ? 0 : 1);
  }
  const target = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
  const strict = argv.includes("--strict");
  const outDir = resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join("shots", basename(target).replace(/\.html$/, "")));
  mkdirSync(outDir, { recursive: true });
  const errors = new Set();
  const notes = new Set();
  const shots = [];
  for (const [label, size] of [
    ["desktop", { width: 1280, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    for (const theme of label === "desktop" ? ["light", "dark"] : ["light"]) {
      const page = await open(target, { ...size, scale: 1, theme, wait: 800 });
      const figs = await page.evaluate(`[...document.querySelectorAll(".dx")].map((f) => f.id)`);
      for (const id of figs) {
        const FIG = JSON.stringify(`#${id}`);
        const levels = await page.evaluate(`(() => { const s = document.querySelector('script[data-dissect="${id}"]'); return Object.keys(JSON.parse(s.textContent).options.metas); })()`);
        // a busy, representative moment, paused, so the pictures do not depend on timing
        await page.evaluate(`(() => { const f = document.querySelector(${FIG}).dissect; f.pause(); const h = JSON.parse(document.querySelector('script[data-dissect="${id}"]').textContent).model.horizon || 600; f.seek(h * 0.4); f.pause(); })()`);
        const visit = label === "desktop" ? levels : [""];
        for (const lv of visit) {
          await page.evaluate(`document.querySelector(${FIG}).dissect.open(${JSON.stringify(lv)})`);
          await sleep(750);
          const r = await page.evaluate(MEASURE.replace("FIG", FIG));
          for (const e of r.errors) errors.add(`${id} (${label}, ${theme}) ${e}`);
          if (label === "desktop") for (const n of r.notes) notes.add(`${id} ${n}`);
          await page.scrollTo(`#${id} .dx-card`);
          const b = await page.boxOf(`#${id} .dx-card`);
          const file = join(outDir, `${id}-${(lv || "top").replace(/\//g, "-")}-${label}-${theme}.png`);
          await page.shot(file, { x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }, 1);
          shots.push(file);
        }
        await page.evaluate(`document.querySelector(${FIG}).dissect.open("")`);
        await sleep(600);
      }
      const sideways = await page.evaluate(`document.documentElement.scrollWidth > innerWidth + 1`);
      if (sideways) errors.add(`the page scrolls sideways at ${size.width} px (${theme})`);
      if (label === "desktop" && theme === "light") {
        // a short drive: it plays, follows, takes a what-if
        for (const id of figs) {
          const FIG = JSON.stringify(`#${id}`);
          const ok = await page.evaluate(`(async () => {
            const root = document.querySelector(${FIG}); const f = root.dissect;
            f.setSpeed(8); f.play(); await new Promise((r) => setTimeout(r, 1500));
            const t0 = f.state().clock; await new Promise((r) => setTimeout(r, 600));
            const moved = f.state().clock > t0;
            const ids = [...f.replay.alive]; if (ids.length) f.follow(ids[ids.length - 1]);
            const followed = !ids.length || f.state().followed != null;
            f.follow(null);
            const st = [...f.replay.st.keys()].find((p) => !p.includes("/"));
            if (st) f.inject({ part: st, set: { work: 1e-3 } });
            const changed = !st || f.state().changes === 1;
            f.undo(); f.pause();
            return { moved, followed, changed };
          })()`);
          if (!ok.moved) errors.add(`${id}: the clock does not move when playing`);
          if (!ok.followed) errors.add(`${id}: following a dot does not take`);
          if (!ok.changed) errors.add(`${id}: a what-if does not apply`);
        }
      }
      for (const p of page.problems) errors.add(`console (${label}, ${theme}): ${p}`);
      await page.close();
    }
  }
  for (const n of notes) console.log(`note     ${n}`);
  for (const e of errors) console.log(`error    ${e}`);
  console.log(`${shots.length} pictures in ${outDir}: read them`);
  const failed = errors.size || (strict && notes.size);
  console.log(failed ? `check failed: ${errors.size} error(s)` : "check passed");
  process.exit(failed ? 1 : 0);
}

if (!needsWebSocketFlag()) await main();
