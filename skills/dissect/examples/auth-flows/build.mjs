// node build.mjs [--light | --dark] [--audit] [--check]  ->  auth-flows.html: both figures on one page
import { fileURLToPath } from "node:url";
import { writePage } from "../../kit/page.mjs";
import { auditOrExit } from "../../kit/audit.mjs";
import { load, captionContext, checkPage } from "../../scripts/build.mjs";

const argv = process.argv.slice(2);
const theme = argv.includes("--light") ? "light" : argv.includes("--dark") ? "dark" : "auto";
const figures = [];
for (const file of ["./model.mjs", "./oauth.mjs"]) {
  const { def, figure } = await load(new URL(file, import.meta.url));
  if (argv.includes("--audit")) auditOrExit(def);
  const caption = typeof figure.caption === "function" ? figure.caption(captionContext(def)) : figure.caption;
  figures.push({ def, opts: { fig: figure.fig, caption, pace: figure.pace, outage: figure.outage, burst: figure.burst, levelPace: figure.levelPace } });
  console.log(`caption  ${caption}`);
}
const out = fileURLToPath(new URL(`./auth-flows${theme === "auto" ? "" : `-${theme}`}.html`, import.meta.url));
const intro = `<h1>Who is calling?</h1><p>Two figures about authentication. The first is the check every request goes through, with a session or with a JWT. The second is how the person gets a session in the first place: logging in with OAuth.</p>`;
const r = writePage(figures[0].def, out, { figures, theme, pageTitle: "Sessions, JWTs and OAuth", intro });
console.log(`wrote ${r.path} (${Math.round(r.bytes / 1024)} kB, ${r.levels.map((l) => `${l.path || "top"} ${l.width}x${l.height}`).join(", ")})`);
if (argv.includes("--check")) checkPage(r.path);
