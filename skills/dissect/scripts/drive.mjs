#!/usr/bin/env node
// Drive a figure in headless Chrome: click, press keys, run the figure's own
// handle, wait for a condition, take shots. A run fails (exit 1) when an
// `until` times out, an `expect` is false, or the page logs an error.

import { needsWebSocketFlag, open, sleep } from "./chrome.mjs";
import { readFileSync } from "node:fs";

const HELP = `Drive a figure in headless Chrome.

  node drive.mjs <page.html | url> '<actions as JSON>' [--width 1280] [--height 900] [--scale 2] [--theme t] [--reduced]
  node drive.mjs <page.html | url> --actions steps.json

Actions run in order. A selector of null means the first figure (.dx).
  ["wait", ms]                    let the page run
  ["click", selector, fx?, fy?]   click a point of an element (fractions, centre by default)
  ["part", path]                  click the part with this path (e.g. "review", "ci/unit")
  ["token"]                       click the first item dot that is drawn
  ["key", key, selector?]         focus an element (default: the first part) and press a key
  ["call", js]                    run JS with fig = the figure's handle (fig.inject(...), fig.open("ci"))
  ["until", js, ms?]              wait until JS (with fig) is true (default 10 s)
  ["expect", js, label?]          JS (with fig) must be true, else the run fails
  ["eval", js]                    run JS and print the result
  ["shot", out.png, selector?, ratio?]
  ["state"]                       print fig.state()

Prints each step's result, then console errors.`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(argv.length ? 0 : 1);
  }
  const o = { width: 1280, height: 900, scale: 2 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--width") o.width = Number(argv[++i]);
    else if (a === "--height") o.height = Number(argv[++i]);
    else if (a === "--scale") o.scale = Number(argv[++i]);
    else if (a === "--theme") o.theme = argv[++i];
    else if (a === "--reduced") o.reduced = true;
    else if (a === "--actions") o.actions = JSON.parse(readFileSync(argv[++i], "utf8"));
    else rest.push(a);
  }
  const [target, script] = rest;
  const actions = o.actions ?? JSON.parse(script ?? "[]");
  const page = await open(target, { ...o, wait: 600 });
  const fig = `document.querySelector(".dx").dissect`;
  const withFig = (js) => `(async()=>{const fig=${fig};return (${js});})()`;
  let failed = false;
  try {
    for (const act of actions) {
      const [kind, ...args] = act;
      if (kind === "wait") await sleep(args[0]);
      else if (kind === "click") {
        const sel = args[0] ?? ".dx";
        await page.scrollTo(sel);
        const b = await page.boxOf(sel);
        await page.click(b.vx + b.w * (args[1] ?? 0.5), b.vy + b.h * (args[2] ?? 0.5));
        await sleep(120);
      } else if (kind === "part") {
        const sel = `.dx-part[data-path="${args[0]}"]`;
        await page.scrollTo(sel);
        const b = await page.boxOf(sel);
        await page.click(b.vx + b.w * 0.5, b.vy + b.h * 0.3);
        await sleep(150);
      } else if (kind === "token") {
        const hit = await page.evaluate(`(()=>{const el=[...document.querySelectorAll(".dx-stage>svg:not(.dx-off) [data-tok] .dx-tok-hit")].find(e=>+e.getAttribute("r")>0);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,id:el.parentNode.getAttribute("data-tok")}})()`);
        if (!hit) throw new Error("no item dot is drawn");
        await page.click(hit.x, hit.y);
        console.log(`clicked item ${hit.id}`);
        await sleep(150);
      } else if (kind === "key") {
        const sel = args[1] ?? ".dx-stage>svg:not(.dx-off) .dx-part";
        await page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(el)el.focus()})()`);
        await page.key(args[0]);
        await sleep(200);
      } else if (kind === "call") console.log("call:", JSON.stringify(await page.evaluate(withFig(args[0]))) ?? "ok");
      else if (kind === "until") {
        const end = Date.now() + (args[1] ?? 10000);
        while (!(await page.evaluate(withFig(args[0])))) {
          if (Date.now() > end) throw new Error(`timed out waiting for ${args[0]}`);
          await sleep(100);
        }
      } else if (kind === "expect") {
        const ok = await page.evaluate(withFig(args[0]));
        console.log(`${ok ? "ok  " : "FAIL"} ${args[1] ?? args[0]}`);
        if (!ok) failed = true;
      } else if (kind === "eval") console.log("eval:", JSON.stringify(await page.evaluate(`(async()=>(${args[0]}))()`)));
      else if (kind === "state") console.log("state:", JSON.stringify(await page.evaluate(withFig("fig.state()"))));
      else if (kind === "shot") {
        const sel = args[1] ?? ".dx";
        await page.scrollTo(sel);
        const b = await page.boxOf(sel);
        await page.shot(args[0], { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 }, args[2] ?? 1);
        console.log(`saved ${args[0]}`);
      } else throw new Error(`unknown action ${kind}`);
    }
  } catch (e) {
    console.error(e.message || e);
    failed = true;
  }
  console.log(page.problems.length ? page.problems.join("\n") : "console: clean");
  await page.close();
  process.exit(failed || page.problems.length ? 1 : 0);
}

if (!needsWebSocketFlag()) await main();
