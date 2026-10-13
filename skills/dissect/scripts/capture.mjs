#!/usr/bin/env node
// Screenshots of a built figure in headless Chrome, with the page's console
// errors, and whether the page scrolls sideways.

import { needsWebSocketFlag, open, sleep } from "./chrome.mjs";
import { resolve } from "node:path";

const HELP = `Capture a figure with headless Chrome.

  node capture.mjs <page.html | url> [options]

  --out <png>          output file (default capture.png)
  --select <css>       clip to this element (default .dx-card, else the page)
  --width <px>         viewport width (default 1280; 390 for a phone)
  --height <px>        viewport height (default 900)
  --scale <n>          device pixel ratio (default 2)
  --wait <ms>          let the page run this long first (default 1500)
  --theme <t>          emulate prefers-color-scheme: light or dark
  --reduced            emulate prefers-reduced-motion: reduce
  --zoom <x,y,w,h>     clip a region of the selected element (CSS px) for close-ups
  --zoom-scale <n>     pixel ratio for a --zoom shot (default 4)
  --times <ms,...>     more shots this long after the first, saved as name-<ms>.png
  --eval <js>          run this in the page before the first shot (awaited)

Prints the clip box, the readout, console errors and exceptions, and whether
the page scrolls sideways.`;

function parse(argv) {
  const o = { width: 1280, height: 900, scale: 2, wait: 1500, zoomScale: 4, times: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--out") o.out = next();
    else if (a === "--select") o.select = next();
    else if (a === "--width") o.width = Number(next());
    else if (a === "--height") o.height = Number(next());
    else if (a === "--scale") o.scale = Number(next());
    else if (a === "--wait") o.wait = Number(next());
    else if (a === "--theme") o.theme = next();
    else if (a === "--reduced") o.reduced = true;
    else if (a === "--zoom") o.zoom = next().split(",").map(Number);
    else if (a === "--zoom-scale") o.zoomScale = Number(next());
    else if (a === "--times") o.times = next().split(",").map(Number);
    else if (a === "--eval") o.eval = next();
    else if (a === "--help" || a === "-h") o.help = true;
    else rest.push(a);
  }
  o.target = rest[0];
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help || !o.target) {
    console.log(HELP);
    process.exit(o.help ? 0 : 1);
  }
  const out = resolve(o.out ?? "capture.png");
  const page = await open(o.target, { width: o.width, height: o.height, scale: o.scale, reduced: o.reduced, theme: o.theme, wait: o.wait });
  try {
    if (o.eval) await page.evaluate(`(async()=>{${o.eval}})()`);
    const select = o.select ?? ((await page.evaluate(`!!document.querySelector(".dx-card")`)) ? ".dx-card" : "body");
    await page.scrollTo(select);
    const clipOf = async () => {
      const box = await page.boxOf(select);
      if (!o.zoom) return { box, clip: { x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 }, ratio: 1 };
      const [zx, zy, zw, zh] = o.zoom;
      return { box, clip: { x: box.x + zx, y: box.y + zy, w: zw, h: zh }, ratio: o.zoomScale / o.scale };
    };
    const first = await clipOf();
    await page.shot(out, first.clip, first.ratio);
    const t0 = Date.now();
    const readout = () => page.evaluate(`(document.querySelector("[data-readout]")||{}).textContent||""`);
    const later = [];
    for (const ms of [...o.times].sort((a, b) => a - b)) {
      await sleep(Math.max(0, t0 + ms - Date.now()));
      const c = await clipOf();
      await page.shot(out.replace(/\.png$/, `-${ms}.png`), c.clip, c.ratio);
      later.push(`+${ms}ms "${await readout()}"`);
    }
    const sideways = await page.evaluate(`document.documentElement.scrollWidth > innerWidth + 1`);
    const b = first.box;
    console.log(`saved ${out}`);
    console.log(`clip ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)} · readout "${await readout()}" · scrolls sideways: ${sideways ? "YES" : "no"}`);
    if (later.length) console.log(`later: ${later.join(" · ")}`);
    console.log(page.problems.length ? page.problems.join("\n") : "console: clean");
    await page.close();
    process.exit(page.problems.length ? 2 : 0);
  } catch (e) {
    console.error(e.message || e);
    await page.close();
    process.exit(1);
  }
}

if (!needsWebSocketFlag()) await main();
