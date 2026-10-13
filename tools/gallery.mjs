// Rebuild every example (auto, light and dark) and capture the README images.
//   node tools/gallery.mjs            all examples
//   node tools/gallery.mjs memory     one
// Each image is the figure's card at a fixed model time, paused, so the
// images do not depend on how fast the machine runs.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "../skills/dissect/scripts/chrome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "skills", "dissect", "examples");
const OUT = join(ROOT, "assets");
// where to stop each figure for its picture (model time) and which figure on the page
const AT = { "ci-pipeline": 170, "request-path": 260, "tcp-ip": 330, pubsub: 520, serverless: 900, "auth-flows": 640, memory: 60, "incident-response": 230, aes: 120, "llm-harness": 20000, "neural-network": 900, etl: 600, cuda: 6, ddos: 75 };
const only = process.argv[2];
for (const name of readdirSync(EX).sort()) {
  if (only && name !== only) continue;
  const dir = join(EX, name);
  if (!existsSync(join(dir, "build.mjs"))) continue;
  for (const flag of [[], ["--light"], ["--dark"]]) execFileSync(process.execPath, [join(dir, "build.mjs"), ...flag], { stdio: "ignore" });
  for (const theme of ["light", "dark"]) {
    const page = await open(join(dir, `${name}-${theme}.html`), { width: 1360, height: 1000, scale: 1.5, wait: 900 });
    await page.evaluate(`(()=>{const f=document.querySelector(".dx").dissect;f.pause();f.seek(${AT[name] ?? 100});f.pause();})()`);
    await new Promise((r) => setTimeout(r, 700));
    const box = await page.boxOf(".dx");
    await page.shot(join(OUT, `${name}-${theme}.png`), { x: box.x - 10, y: box.y - 10, w: box.w + 20, h: box.h + 20 });
    if (page.problems.length) console.log(name, theme, page.problems.join("\n"));
    await page.close();
  }
  console.log(`${name}: built and captured`);
}
