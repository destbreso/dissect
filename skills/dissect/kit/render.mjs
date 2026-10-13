// Drawing. Every part is a small instrument: a plate with a bevel, its name,
// what it does, the bays where work sits while it is done, its ports, a status
// lamp, a utilization gauge and its counters; the queue forms on the rail that
// leads into it. Each detail stands for a quantity of the model, and none is
// decoration.
//
// Everything here returns strings, so a Node build script can write a page with
// no framework and no dependencies. Each sheet also returns `meta`, the
// geometry the live page needs to place work items: route polylines, queue
// slots, bays, needles, pins, mini-maps.

import { short } from "./dist.mjs";
import { along, roundedPath } from "./geom.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (v) => (Math.round(v * 2) / 2).toString();

// ---- glyphs (16 x 16, stroked) ----------------------------------------------
export const GLYPHS = {
  service: "M8 4.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1",
  human: "M8 2.6a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6M3.4 14c.4-3 2.2-4.6 4.6-4.6s4.2 1.6 4.6 4.6",
  team: "M5.6 3.4a2 2 0 1 1 0 4a2 2 0 1 1 0-4M11 4.4a1.7 1.7 0 1 1 0 3.4a1.7 1.7 0 1 1 0-3.4M1.8 13.4c.3-2.6 1.7-4 3.8-4s3.5 1.4 3.8 4M9.6 9.6c.5-.2 .9-.3 1.4-.3c1.8 0 3 1.2 3.2 3.4",
  robot: "M4 5.5h8v7H4zM8 3v2.5M6.3 8.4h.1M9.6 8.4h.1M6.4 10.8h3.2M2.6 8v2.5M13.4 8v2.5",
  build: "M3 13l5.4-5.4M10.4 2.6a3 3 0 0 0-2.6 4l-1 1l1.6 1.6l1-1a3 3 0 0 0 4-2.6l-1.6 1.2l-1.6-.4l-.4-1.6z",
  test: "M6 2h4M6.8 2v4.2L3.2 12.4a1 1 0 0 0 .9 1.6h7.8a1 1 0 0 0 .9-1.6L9.2 6.2V2M5 10h6",
  deploy: "M8 2.4c2.4 1.6 3.4 4 3.2 7.2L8 12.2L4.8 9.6C4.6 6.4 5.6 4 8 2.4zM8 6.2v.1M4.8 9.6L3 11.6l1.6.6M11.2 9.6l1.8 2l-1.6.6M7 12.6L8 14.4l1-1.8",
  review: "M1.8 8s2.4-4.4 6.2-4.4S14.2 8 14.2 8s-2.4 4.4-6.2 4.4S1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6",
  code: "M5.6 4.4L2 8l3.6 3.6M10.4 4.4L14 8l-3.6 3.6M9 3l-2 10",
  merge: "M4.4 2.6v10.8M4.4 5.4c0 3 7.2 2 7.2 5.6v2.4M4.4 2.6a1.2 1.2 0 1 1 0 .1M11.6 13.4a1.2 1.2 0 1 1 0 .1",
  db: "M3 4.2C3 3 5.2 2.2 8 2.2s5 .8 5 2s-2.2 2-5 2s-5-.8-5-2zM3 4.2v7.6c0 1.2 2.2 2 5 2s5-.8 5-2V4.2M3 8c0 1.2 2.2 2 5 2s5-.8 5-2",
  cache: "M8 2.2l5.8 2.9L8 8L2.2 5.1zM2.2 8L8 10.9L13.8 8M2.2 10.9L8 13.8l5.8-2.9",
  network: "M8 1.8a6.2 6.2 0 1 1 0 12.4a6.2 6.2 0 1 1 0-12.4M1.8 8h12.4M8 1.8c1.8 1.8 2.6 3.8 2.6 6.2S9.8 12.4 8 14.2M8 1.8C6.2 3.6 5.4 5.6 5.4 8s.8 4.4 2.6 6.2",
  server: "M2.6 2.8h10.8v4.4H2.6zM2.6 8.8h10.8v4.4H2.6zM4.8 5h.1M4.8 11h.1M7.4 5h4M7.4 11h4",
  balance: "M8 2.4v11.2M4.4 13.6h7.2M2.4 5.2h11.2M2.4 5.2L1 9.2a1.6 1.6 0 0 0 2.8 0zM13.6 5.2L12.2 9.2a1.6 1.6 0 0 0 2.8 0z",
  mail: "M2.2 4h11.6v8H2.2zM2.2 4.4L8 9l5.8-4.6",
  lock: "M4 7.2h8v6.4H4zM5.6 7.2V5.4a2.4 2.4 0 0 1 4.8 0v1.8M8 9.6v1.6",
  key: "M5.4 6.4a3 3 0 1 1 0 .1M7.8 8.6l5.6 5.6M11 11.8l1.4-1.4M12.4 13.2l1.2-1.2",
  gate: "M2.6 13.4V6.2L8 2.6l5.4 3.6v7.2M5.6 13.4V8.6h4.8v4.8",
  queue: "M2.6 4.2h10.8M2.6 8h10.8M2.6 11.8h6.6",
  cloud: "M4.6 12.2a2.8 2.8 0 0 1-.4-5.6a3.8 3.8 0 0 1 7.3-.8a2.6 2.6 0 0 1 .6 5.2z",
  phone: "M5.2 1.8h5.6v12.4H5.2zM7.2 12.2h1.6",
  browser: "M1.8 3h12.4v10H1.8zM1.8 5.8h12.4M3.6 4.4h.1M5 4.4h.1",
  doc: "M4 1.8h5.4L12 4.4v9.8H4zM9.2 1.8v2.8H12M5.8 7.4h4.4M5.8 9.6h4.4M5.8 11.8h2.8",
  check: "M2.8 8.4l3.2 3.2l7.2-7.2",
  bell: "M4.4 11V7.4a3.6 3.6 0 0 1 7.2 0V11l1.2 1.4H3.2zM6.8 13.6a1.2 1.2 0 0 0 2.4 0",
  search: "M7 2.6a4.4 4.4 0 1 1 0 8.8a4.4 4.4 0 1 1 0-8.8M10.2 10.2l3.6 3.6",
  wrench: "M10.6 2.2a3.2 3.2 0 0 0-3 4.4L2.6 11.6l1.8 1.8l5-5a3.2 3.2 0 0 0 4.4-3l-1.8 1.4l-1.8-.6l-.4-1.8z",
  money: "M1.8 4.2h12.4v7.6H1.8zM8 6.2a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6M4 6.4v3.2M12 6.4v3.2",
  truck: "M1.6 4h7.6v6.6H1.6zM9.2 6.4h3l2.2 2.2v2H9.2zM4 12.2a1.3 1.3 0 1 1 0 .1M11.6 12.2a1.3 1.3 0 1 1 0 .1",
};

const GUESS = [
  [/review|approv|inspect/, "review"],
  [/test|qa\b|check|verify|lint/, "test"],
  [/build|compile|package|bundle/, "build"],
  [/deploy|release|ship\b|launch|canary|rollout|promote/, "deploy"],
  [/merge/, "merge"],
  [/code|commit|write|develop|fix|patch/, "code"],
  [/\bdb\b|database|postgres|mysql|sql|store/, "db"],
  [/cache|redis|memcache/, "cache"],
  [/balanc|\blb\b|router|proxy|gateway/, "balance"],
  [/server|api|backend|worker|service|handler/, "server"],
  [/network|dns|cdn|internet|edge/, "network"],
  [/mail|email|notify/, "mail"],
  [/page|alert|incident|on-?call/, "bell"],
  [/auth|login|token|oauth|sign/, "key"],
  [/secur|lock|encrypt|tls/, "lock"],
  [/search|find|triage|investigat|diagnos/, "search"],
  [/repair|mitigat|restore|maint/, "wrench"],
  [/pay|bill|invoice|charge|refund/, "money"],
  [/deliver|dispatch|courier|shipping/, "truck"],
  [/browser|client|user agent/, "browser"],
  [/phone|mobile|\bapp\b/, "phone"],
  [/team|squad|crew|staff/, "team"],
  [/person|human|engineer|developer|agent|clerk|nurse|doctor/, "human"],
  [/\bbot\b|robot|automat|\bai\b|llm/, "robot"],
  [/queue|backlog|inbox/, "queue"],
  [/doc|form|spec|ticket|request/, "doc"],
];

/** The glyph a part shows: its own `glyph`, else one guessed from its words. */
export function glyphOf(part) {
  if (part.glyph && GLYPHS[part.glyph]) return part.glyph;
  const w = `${part.id} ${part.label || ""}`.toLowerCase();
  for (const [re, g] of GUESS) if (re.test(w)) return g;
  return "service";
}

// ---- themes -------------------------------------------------------------------
export const THEMES = {
  light: {
    paper: "#f4f3ee",
    sheet: "#fbfaf6",
    dot: "#dcd9cf",
    ink: "#1d1c1a",
    ink2: "#55534d",
    ink3: "#6c6a64",
    edge: "#2a2926",
    plate: "#ffffff",
    plate2: "#f3f2ec",
    bevel: "#ffffff",
    seam: "#e4e1d8",
    shade: "rgba(29, 28, 26, 0.13)",
    rail: "#3b3a35",
    bed: "#e9e6dd",
    laneA: "rgba(255, 255, 255, 0)",
    laneB: "rgba(29, 28, 26, 0.024)",
    rule: "#dedbd1",
    bay: "#eeece5",
    accent: "#c2410c",
    ok: "#2b8a3e",
    warn: "#b35c00",
    bad: "#c92a2a",
    tag: "#ffffff",
    c0: "#1d1c1a",
    c1: "#1864ab",
    c2: "#2b8a3e",
    c3: "#862e9c",
    c4: "#0b7285",
  },
  dark: {
    paper: "#121211",
    sheet: "#171715",
    dot: "#2c2b28",
    ink: "#eceae4",
    ink2: "#b3b1aa",
    ink3: "#8f8d85",
    edge: "#d8d6cf",
    plate: "#1f1f1c",
    plate2: "#262622",
    bevel: "#3a3934",
    seam: "#34332f",
    shade: "rgba(0, 0, 0, 0.5)",
    rail: "#cfcdc6",
    bed: "#262623",
    laneA: "rgba(255, 255, 255, 0)",
    laneB: "rgba(255, 255, 255, 0.026)",
    rule: "#2e2d2a",
    bay: "#2b2b27",
    accent: "#ff8a4c",
    ok: "#69db7c",
    warn: "#ffa94d",
    bad: "#ff6b6b",
    tag: "#1f1f1c",
    c0: "#eceae4",
    c1: "#74c0fc",
    c2: "#8ce99a",
    c3: "#e599f7",
    c4: "#66d9e8",
  },
};
export const CLASS_COLORS = 5;

const vars = (t) => Object.entries(t).map(([k, v]) => `--dx-${k}:${v};`).join("");

/** The figure's styles, scoped under .dx and themed by data-theme (light, dark or auto). */
export function css() {
  return `
.dx{${vars(THEMES.light)}color:var(--dx-ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Liberation Sans",system-ui,sans-serif;font-variant-numeric:tabular-nums;max-width:1240px;margin:0 auto}
.dx[data-theme="dark"]{${vars(THEMES.dark)}}
@media (prefers-color-scheme:dark){.dx[data-theme="auto"]{${vars(THEMES.dark)}}}
.dx *{box-sizing:border-box}
.dx-card{position:relative;container-type:inline-size;background:var(--dx-paper);border:1px solid var(--dx-rule);border-radius:14px;box-shadow:0 1px 0 var(--dx-bevel) inset,0 22px 50px -32px var(--dx-shade);overflow:hidden}
.dx-head,.dx-foot{display:flex;align-items:center;gap:12px;padding:10px 16px;font-size:12px;color:var(--dx-ink2);min-width:0}
.dx-head{border-bottom:1px solid var(--dx-rule)}
.dx-foot{border-top:1px solid var(--dx-rule)}
.dx-fig{font-weight:650;color:var(--dx-ink);letter-spacing:.02em;white-space:nowrap}
.dx-title{margin-left:auto;font-weight:600;color:var(--dx-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dx-body{display:grid;grid-template-columns:minmax(0,1fr)}
@container (min-width:1080px){.dx-body{grid-template-columns:minmax(0,1fr) 272px}.dx-inspector{border-top:0!important;border-left:1px solid var(--dx-rule)}}
.dx-view{position:relative;display:flex;flex-direction:column;min-width:0;background:var(--dx-sheet)}
.dx-levelbar{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;border-bottom:1px solid var(--dx-rule);background:linear-gradient(var(--dx-plate2),var(--dx-sheet));font-size:12px;min-width:0}
.dx-levelbar[hidden]{display:none}
.dx-path{display:flex;align-items:center;gap:1px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.dx-path button{all:unset;cursor:pointer;color:var(--dx-ink2);padding:4px 7px;border-radius:6px;overflow:hidden;text-overflow:ellipsis}
.dx-path button:hover{background:var(--dx-plate);color:var(--dx-ink)}
.dx-path button:focus-visible{outline:2px solid var(--dx-accent)}
.dx-path [aria-current]{color:var(--dx-ink);font-weight:650;padding:4px 7px;overflow:hidden;text-overflow:ellipsis}
.dx-pathsep{color:var(--dx-ink3);opacity:.7}
.dx-stage{position:relative;display:grid;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;transition:height .5s cubic-bezier(.2,.7,.2,1)}
.dx-stage>svg{display:block;width:100%;height:auto;justify-self:center;transform-origin:50% 50%;transition:transform .5s cubic-bezier(.2,.7,.2,1),opacity .4s ease}
.dx-stage>svg.dx-off{position:absolute;top:0;left:0;width:100%!important;visibility:hidden;opacity:0;pointer-events:none}
.dx-dock{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 10px;border-top:1px solid var(--dx-rule);background:linear-gradient(var(--dx-sheet),var(--dx-plate2));flex-wrap:wrap;row-gap:6px;font-size:12px}
.dx-keys{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dx-key{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;min-width:28px;padding:0 8px;border:1px solid var(--dx-edge);border-radius:8px;background:var(--dx-plate);color:var(--dx-ink);box-shadow:inset 0 1px 0 var(--dx-bevel),0 1px 2px var(--dx-shade);font-size:11.5px;font-weight:600;white-space:nowrap}
.dx-key:hover{background:var(--dx-plate2)}
.dx-key:active{box-shadow:inset 0 1px 2px var(--dx-shade)}
.dx-key:focus-visible{outline:2px solid var(--dx-accent);outline-offset:1px}
.dx-key svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.dx-key.dx-icon{padding:0;width:28px}
.dx-seg{display:inline-flex;height:28px;border:1px solid var(--dx-edge);border-radius:8px;overflow:hidden;background:var(--dx-plate);box-shadow:inset 0 1px 0 var(--dx-bevel),0 1px 2px var(--dx-shade)}
.dx-seg button{all:unset;cursor:pointer;padding:0 9px;display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--dx-ink2)}
.dx-seg button+button{border-left:1px solid var(--dx-rule)}
.dx-seg button:hover{color:var(--dx-ink);background:var(--dx-plate2)}
.dx-seg button[aria-pressed="true"]{background:var(--dx-ink);color:var(--dx-plate)}
.dx-seg button:focus-visible{outline:2px solid var(--dx-accent);outline-offset:-2px}
.dx-readout{margin-left:auto;padding-left:8px;color:var(--dx-ink);white-space:nowrap;font-variant-numeric:tabular-nums}
.dx-close svg{width:12px;height:12px}
.dx-inspector{border-top:1px solid var(--dx-rule);padding:14px 16px 16px;font-size:12.5px;color:var(--dx-ink2);background:var(--dx-paper);min-height:120px}
.dx-inspector h3{margin:0;font-size:14px;color:var(--dx-ink);font-weight:650}
.dx-inspector .dx-kind{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dx-ink3);margin-bottom:2px}
.dx-inspector p{margin:8px 0;max-width:68ch}
.dx-inspector dl{display:grid;grid-template-columns:auto auto;justify-content:start;gap:3px 18px;margin:10px 0}
.dx-inspector dt{color:var(--dx-ink3)}
.dx-inspector dd{margin:0;color:var(--dx-ink)}
.dx-inspector .dx-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.dx-inspector a{color:var(--dx-accent)}
.dx-btn{all:unset;cursor:pointer;font-size:11.5px;line-height:1;padding:6px 9px;border:1px solid var(--dx-rule);border-radius:7px;color:var(--dx-ink);background:var(--dx-plate);white-space:nowrap}
.dx-btn:hover{border-color:var(--dx-ink3)}
.dx-btn:focus-visible{outline:2px solid var(--dx-accent);outline-offset:1px}
.dx-hint{flex:1 1 220px;min-width:0;color:var(--dx-ink3)}
.dx-journey{list-style:none;margin:8px 0 0;padding:0;max-height:210px;overflow:auto;font-size:12px}
.dx-journey li{display:grid;grid-template-columns:5.2em 1fr;gap:8px;padding:3px 0;border-bottom:1px dashed var(--dx-rule)}
.dx-journey time{color:var(--dx-ink3);text-align:right}
.dx-caption{margin:12px 4px 0;font-size:13px;color:var(--dx-ink2);max-width:80ch}
.dx-legend{display:flex;flex-wrap:wrap;gap:16px;margin:8px 4px 0;font-size:12px;color:var(--dx-ink3)}
.dx-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.dx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dx svg text{font-family:inherit;font-variant-numeric:tabular-nums}
.dx-dots{fill:var(--dx-dot)}
.dx-lane{fill:var(--dx-laneA)}
.dx-lane.dx-alt{fill:var(--dx-laneB)}
.dx-lane-rule{stroke:var(--dx-rule);stroke-width:1}
.dx-lane-plate{fill:var(--dx-plate2);stroke:var(--dx-rule)}
.dx-lane-label{fill:var(--dx-ink2);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:650}
.dx-bed{fill:none;stroke:var(--dx-bed);stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.dx-rail{fill:none;stroke:var(--dx-rail);stroke-width:1.35;stroke-linejoin:round;transition:stroke .3s,stroke-width .3s}
.dx-chev{fill:none;stroke:var(--dx-rail);stroke-width:1.1;stroke-linecap:round;stroke-linejoin:round;opacity:.5}
.dx-nib{fill:var(--dx-rail)}
.dx-tag rect{fill:var(--dx-tag);stroke:var(--dx-rail);stroke-width:.9}
.dx-tag text{fill:var(--dx-ink2);font-size:9.5px;font-weight:650;letter-spacing:.02em}
.dx-slot{stroke:var(--dx-ink3);stroke-width:1;stroke-linecap:round;opacity:.7}
.dx-more{fill:var(--dx-ink2);font-size:9.5px;font-weight:600}
.dx-halo{fill:var(--dx-shade);filter:blur(5px)}
.dx-plate{fill:var(--dx-plate);stroke:var(--dx-edge);stroke-width:1.1;transition:stroke .2s}
.dx-bevel{fill:none;stroke:var(--dx-bevel);stroke-width:1.2;opacity:.9}
.dx-seam{stroke:var(--dx-seam);stroke-width:1;fill:none}
.dx-glyph{fill:none;stroke:var(--dx-ink);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dx-name{fill:var(--dx-ink);font-size:12.5px;font-weight:620}
.dx-spec{fill:var(--dx-ink3);font-size:10px}
.dx-alt-text{fill:var(--dx-ink2);font-size:10px;font-weight:600;opacity:0}
.dx-bay{fill:var(--dx-bay);stroke:var(--dx-seam);stroke-width:.8}
.dx-bay-fill{fill:var(--dx-ink);opacity:.8}
.dx-bay-fill.dx-c-bad{fill:var(--dx-bad);opacity:1}
.dx-bay-fill.dx-lit{fill:var(--dx-accent);opacity:1}
.dx-rack{fill:var(--dx-ink2);font-size:9.5px}
.dx-port{fill:var(--dx-plate);stroke:var(--dx-edge);stroke-width:1.1}
.dx-port-core{fill:var(--dx-edge)}
.dx-lamp{fill:var(--dx-ink3);transition:fill .2s}
.dx-lamp[data-state="busy"]{fill:var(--dx-ok)}
.dx-lamp[data-state="queued"]{fill:var(--dx-warn)}
.dx-lamp[data-state="down"]{fill:var(--dx-bad)}
.dx-gauge-track{fill:none;stroke:var(--dx-seam);stroke-width:2.2}
.dx-gauge{fill:none;stroke:var(--dx-ink2);stroke-width:2.2;stroke-linecap:round}
.dx-count{fill:var(--dx-ink3);font-size:9.5px}
.dx-count .dx-bad{fill:var(--dx-bad)}
.dx-window{fill:var(--dx-plate2);stroke:var(--dx-seam)}
.dx-mini{fill:none;stroke:var(--dx-ink3);stroke-width:.8;opacity:.7}
.dx-mini-part{fill:var(--dx-plate);stroke:var(--dx-ink3);stroke-width:.7}
.dx-corner{fill:none;stroke:var(--dx-ink2);stroke-width:1.2;stroke-linecap:round}
.dx-gate-mark{fill:none;stroke:var(--dx-ink);stroke-width:1.8;stroke-linecap:round}
.dx-needle{stroke:var(--dx-accent);stroke-width:1.7;stroke-linecap:round;transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.dx-hub{fill:var(--dx-accent)}
.dx-pin{fill:var(--dx-plate);stroke:var(--dx-ink3);stroke-width:.9;transition:fill .2s}
.dx-pin[data-on="1"]{fill:var(--dx-ink);stroke:var(--dx-ink)}
.dx-event{fill:var(--dx-plate);stroke:var(--dx-edge);stroke-width:1.2}
.dx-event.dx-end{stroke-width:3}
.dx-tick{stroke:var(--dx-ink3);stroke-width:.9;stroke-linecap:round}
.dx-hand{stroke:var(--dx-ink);stroke-width:1.4;stroke-linecap:round}
.dx-done{fill:var(--dx-ink);font-size:10px;font-weight:650}
.dx-under{fill:var(--dx-ink2);font-size:10px}
.dx-under.dx-strong{fill:var(--dx-ink);font-weight:600}
.dx-store-body{fill:var(--dx-plate);stroke:var(--dx-edge);stroke-width:1.1}
.dx-store-top{fill:var(--dx-plate2);stroke:var(--dx-edge);stroke-width:1.1}
.dx-use{fill:none;stroke:var(--dx-ink3);stroke-width:1;stroke-dasharray:2 3;transition:stroke .3s}
.dx-use.dx-on{stroke:var(--dx-accent)}
.dx-part{outline:none}
.dx-part[data-open="1"]{cursor:zoom-in}
.dx-part:not([data-open]){cursor:pointer}
.dx-part:focus-visible .dx-plate,.dx-part:focus-visible .dx-event,.dx-part:focus-visible .dx-store-body{stroke:var(--dx-accent);stroke-width:2.2}
.dx-part.dx-sel .dx-plate,.dx-part.dx-sel .dx-event,.dx-part.dx-sel .dx-store-body{stroke:var(--dx-accent);stroke-width:1.8}
.dx-route.dx-pass .dx-rail{stroke:color-mix(in oklab,var(--dx-accent) 60%,var(--dx-rail))}
.dx-tok{stroke:var(--dx-sheet);stroke-width:1.3}
.dx-tok.dx-c-bad{fill:var(--dx-bad)!important}
.dx-tok.dx-lit{fill:var(--dx-accent)!important}
.dx-tok-hit{fill:transparent;cursor:pointer}
.dx-tok-halo{fill:none;stroke:var(--dx-accent);stroke-width:1.4;opacity:.55}
.dx-trail{fill:none;stroke:var(--dx-accent);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;opacity:.4}
.dx-heat-bar{fill:var(--dx-accent);opacity:0;transition:opacity .3s}
.dx-heat-work{fill:var(--dx-ink2);opacity:0;transition:opacity .3s}
.dx[data-layer="time"] .dx-heat-bar{opacity:.85}
.dx[data-layer="time"] .dx-heat-work{opacity:.5}
.dx[data-layer="time"] .dx-flowrow,.dx[data-layer="fail"] .dx-flowrow{opacity:0}
.dx[data-layer="time"] .dx-spec,.dx[data-layer="fail"] .dx-spec{opacity:0}
.dx[data-layer="time"] .dx-alt-time,.dx[data-layer="fail"] .dx-alt-fail{opacity:1}
.dx[data-layer="time"] .dx-opens [data-count],.dx[data-layer="fail"] .dx-opens [data-count]{opacity:0}
.dx[data-layer="fail"] .dx-route:not([data-fail="1"]),.dx[data-layer="fail"] .dx-tag:not([data-fail="1"]){opacity:.3}
.dx-tag{pointer-events:none}
.dx[data-layer="fail"] .dx-route[data-fail="1"] .dx-rail{stroke:var(--dx-bad);stroke-width:2}
.dx-flowrow{transition:opacity .3s}
.dx-spec,.dx-alt-text{transition:opacity .3s}
@media (prefers-reduced-motion:reduce){.dx *{transition:none!important}}
`;
}

// ---- shared bits ---------------------------------------------------------------
const textWidth = (s, size) => String(s).length * size * 0.56;

/** Fit a string into a width: shrink a little, then cut it with an ellipsis. */
export function fitText(s, width, size, min = 10.5) {
  let sz = size;
  while (textWidth(s, sz) > width && sz > min) sz -= 0.5;
  if (textWidth(s, sz) <= width) return { text: String(s), size: sz, cut: false };
  let t = String(s);
  while (t.length > 1 && textWidth(`${t}…`, sz) > width) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size: sz, cut: true };
}

function halo(x, y, w, h, r) {
  return `<rect class="dx-halo" x="${n(x - w / 2 + 3)}" y="${n(y - h / 2 + 6)}" width="${n(w - 6)}" height="${n(h - 2)}" rx="${r}"/>`;
}

function port(x, y) {
  return `<circle class="dx-port" cx="${n(x)}" cy="${n(y)}" r="3.4"/><circle class="dx-port-core" cx="${n(x)}" cy="${n(y)}" r="1.2"/>`;
}

const sized = (fit, base) => (fit.size !== base ? ` style="font-size:${fit.size}px"` : "");

const stepsInside = (m) => m.parts.filter((p) => p.kind === "station").length;

/** The spec line a station shows under its name. */
export function specOf(part, unit) {
  if (part.spec) return part.spec;
  if (part.inside) return `${stepsInside(part.inside)} steps inside`;
  // capacity is drawn (one bay per server), so the line only says how long one item takes
  return short(part.work, unit);
}

// ---- stations ---------------------------------------------------------------------
// the room a station's bays take on its flow row, whatever their number
const BAY_ROOM = 48;

function station(box, part, model, meta, sheet) {
  const { x, y, w, h } = box;
  const L = x - w / 2;
  const T = y - h / 2;
  const servers = part.servers;
  const open = Boolean(part.inside);
  const finite = Number.isFinite(servers);
  // the name's room ends short of the lamp, which an open step carries in its top corner
  const nameRoom = w - 46 - (open ? 10 : 0);
  const name = fitText(part.label, nameRoom, 12.5);
  const specFit = fitText(specOf(part, model.unit), w - 24 - (open ? 30 : 0), 10, 9);
  let s = halo(x, y, w, h, 9);
  s += `<rect class="dx-plate" x="${n(L)}" y="${n(T)}" width="${w}" height="${h}" rx="9"/>`;
  s += `<rect class="dx-bevel" x="${n(L + 1.6)}" y="${n(T + 1.6)}" width="${n(w - 3.2)}" height="${n(h - 3.2)}" rx="7.6"/>`;
  s += `<path class="dx-glyph" transform="translate(${n(L + 11)} ${n(T + 10)})" d="${GLYPHS[glyphOf(part)]}"/>`;
  // the page fits these again with the reader's own font (data-fit is the room, data-full the words)
  s += `<text class="dx-name" x="${n(L + 33)}" y="${n(T + 22.5)}"${sized(name, 12.5)} data-fit="${nameRoom}" data-full="${esc(part.label)}" data-size="12.5" data-min="10.5">${esc(name.text)}</text>`;
  s += `<text class="dx-spec" x="${n(L + 12)}" y="${n(T + 38)}"${sized(specFit, 10)} data-fit="${w - 24 - (open ? 30 : 0)}" data-full="${esc(specOf(part, model.unit))}" data-size="10" data-min="9">${esc(specFit.text)}</text>`;
  s += `<text class="dx-alt-text dx-alt-time" data-alt="time" x="${n(L + 12)}" y="${n(T + 38)}"></text>`;
  s += `<text class="dx-alt-text dx-alt-fail" data-alt="fail" x="${n(L + 12)}" y="${n(T + 38)}"></text>`;
  // the time and failure layers' words take the spec's place, and its room
  const st = { open, bays: [], rack: null, x, y, w, h, altW: w - 24 - (open ? 30 : 0) };
  if (open) {
    // a window into the machine: what it does inside, drawn small, framed by corners that say it opens
    const wx = L + 10;
    const wy = T + 45;
    const ww = w - 20;
    const wh = h - 53;
    s += `<rect class="dx-window" x="${n(wx)}" y="${n(wy)}" width="${n(ww)}" height="${n(wh)}" rx="4"/>`;
    s += miniMap(part.inside, wx + 7, wy + 5, ww - 14, wh - 10, meta, part.path);
    const c = 5;
    s += `<path class="dx-corner" d="M${n(wx - 2)} ${n(wy + c)}v${-c - 2}h${c + 2}M${n(wx + ww - c)} ${n(wy - 2)}h${c + 2}v${c + 2}M${n(wx + ww + 2)} ${n(wy + wh - c)}v${c + 2}h${-c - 2}M${n(wx + c)} ${n(wy + wh + 2)}h${-c - 2}v${-c - 2}"/>`;
    s += `<circle class="dx-lamp" data-lamp cx="${n(L + w - 15)}" cy="${n(T + 18)}" r="3.2"/>`;
    // the counters share the spec's row, in the 30 px its room leaves them
    s += `<text class="dx-count" data-count data-room="26" x="${n(L + w - 12)}" y="${n(T + 38)}" text-anchor="end"><tspan data-done>✓0</tspan><tspan class="dx-bad" data-fails></tspan></text>`;
  } else {
    s += `<line class="dx-seam" x1="${n(L + 8)}" y1="${n(T + 46)}" x2="${n(L + w - 8)}" y2="${n(T + 46)}"/>`;
    const rowY = T + 58;
    let row = "";
    // the row's left holds the work (bays or a rack), its right the counters and the gauge
    let used;
    if (finite && servers <= 8) {
      // one bay per server, in a fixed room: one row of up to three, two rows from four
      const rows = servers > 3 ? 2 : 1;
      const k = Math.ceil(servers / rows);
      const gap = k <= 2 ? 4 : 3;
      const bw = Math.min(30, Math.floor((BAY_ROOM - (k - 1) * gap) / k));
      const bh = rows === 2 ? 8 : 9;
      for (let i = 0; i < servers; i++) {
        const bx = L + 12 + (i % k) * (bw + gap);
        const by = rows === 2 ? rowY + (i < k ? -4.8 : 4.8) : rowY;
        row += `<rect class="dx-bay" x="${n(bx)}" y="${n(by - bh / 2)}" width="${bw}" height="${bh}" rx="2"/>`;
        row += `<rect class="dx-bay-fill" data-bay="${i}" x="${n(bx + 1.4)}" y="${n(by - bh / 2 + 1.4)}" width="0" height="${n(bh - 2.8)}" rx="1.2"/>`;
        st.bays.push({ x0: bx + 1.4, y: by, w: bw - 2.8 });
      }
      used = k * (bw + gap) - gap;
    } else {
      // no limit: items in work sit in a row; past five, a count
      row += `<text class="dx-rack" data-rack x="${n(L + 12 + 5 * 9 + 1)}" y="${n(rowY + 3.4)}"></text>`;
      st.rack = { x: L + 16, y: rowY, step: 9, max: 5 };
      used = 5 * 9 + 1 + 16;
    }
    const gx = L + w - 15;
    // the page sets the counters smaller when they outgrow the room the work leaves them
    row += `<text class="dx-count" data-count data-room="${n(gx - 11 - (L + 12 + used + 6))}" x="${n(gx - 11)}" y="${n(rowY + 3.4)}" text-anchor="end"><tspan data-done>✓0</tspan><tspan class="dx-bad" data-fails></tspan></text>`;
    s += `<g class="dx-flowrow">${row}</g>`;
    if (finite) {
      s += `<circle class="dx-gauge-track" cx="${n(gx)}" cy="${n(rowY)}" r="6.2"/>`;
      s += `<circle class="dx-gauge" data-gauge cx="${n(gx)}" cy="${n(rowY)}" r="6.2" stroke-dasharray="0 39" transform="rotate(-90 ${n(gx)} ${n(rowY)})"/>`;
    }
    s += `<circle class="dx-lamp" data-lamp cx="${n(gx)}" cy="${n(rowY)}" r="2.6"/>`;
    // the time layer: where an item's time goes at this step (waiting, then working)
    s += `<rect class="dx-heat-bar" data-heat="wait" x="${n(L + 12)}" y="${n(rowY - 3)}" width="0" height="6" rx="1.5"/>`;
    s += `<rect class="dx-heat-work" data-heat="work" x="${n(L + 12)}" y="${n(rowY - 3)}" width="0" height="6" rx="1.5"/>`;
    st.heat = { x0: L + 12, w: w - 50 };
  }
  // ports: the input and output sides always, and wherever else a route meets the plate
  const at = new Map([box.ports.w, box.ports.e].map((p) => [`${n(p[0])},${n(p[1])}`, p]));
  for (const r of sheet.routes) {
    if (r.from === part.id) at.set(`${n(r.points[0][0])},${n(r.points[0][1])}`, r.points[0]);
    if (r.to === part.id) {
      const q = r.points[r.points.length - 1];
      at.set(`${n(q[0])},${n(q[1])}`, q);
    }
  }
  for (const p of at.values()) s += port(p[0], p[1]);
  meta.stations[part.path] = st;
  return s;
}

function miniMap(inner, x, y, w, h, meta, path) {
  const ps = inner.parts.filter((p) => p.kind !== "store");
  const cols = ps.map((p) => p.at[0]);
  const rows = ps.map((p) => p.at[1] + inner.lanes.findIndex((l) => l.id === p.lane) * 4);
  const c0 = Math.min(...cols);
  const c1 = Math.max(...cols);
  const r0 = Math.min(...rows);
  const r1 = Math.max(...rows);
  const px = (c) => x + (c1 === c0 ? w / 2 : ((c - c0) / (c1 - c0)) * w);
  const py = (r) => y + (r1 === r0 ? h / 2 : ((r - r0) / (r1 - r0)) * h);
  const at = {};
  ps.forEach((p, i) => (at[p.id] = [Math.round(px(p.at[0]) * 10) / 10, Math.round(py(rows[i]) * 10) / 10]));
  let s = "";
  for (const r of inner.routes) {
    const a = at[r.from];
    const b = at[r.to];
    if (!a || !b) continue;
    const mx = b[0] >= a[0] ? (a[0] + b[0]) / 2 : a[0];
    s += `<path class="dx-mini" d="${roundedPath([a, [mx, a[1]], [mx, b[1]], b], 2)}"/>`;
  }
  for (const p of ps) {
    const [cx, cy] = at[p.id];
    if (p.kind === "station") s += `<rect class="dx-mini-part" x="${n(cx - 4.5)}" y="${n(cy - 2.8)}" width="9" height="5.6" rx="1.3"/>`;
    else if (p.kind === "choice" || p.kind === "split" || p.kind === "join") s += `<path class="dx-mini-part" d="M${n(cx)} ${n(cy - 3)}l3 3l-3 3l-3-3z"/>`;
    else s += `<circle class="dx-mini-part" cx="${n(cx)}" cy="${n(cy)}" r="2"/>`;
  }
  meta.minis[path] = at;
  return s;
}

// ---- gateways, events, timers, stores ------------------------------------------------
function gateway(box, part, model, meta, L) {
  const { x, y, w } = box;
  const r = w / 2;
  let s = halo(x, y, w, w, 6);
  s += `<path class="dx-plate" d="M${n(x)} ${n(y - r)}L${n(x + r)} ${n(y)}L${n(x)} ${n(y + r)}L${n(x - r)} ${n(y)}Z"/>`;
  s += `<path class="dx-bevel" d="M${n(x)} ${n(y - r + 2.6)}L${n(x + r - 2.6)} ${n(y)}L${n(x)} ${n(y + r - 2.6)}L${n(x - r + 2.6)} ${n(y)}Z"/>`;
  const gate = { x, y, r, needle: {}, ins: [] };
  if (part.kind === "choice") {
    // the exclusive marker, faint, under a needle that points at the last way taken
    s += `<path class="dx-gate-mark" d="M${n(x - 5.2)} ${n(y - 5.2)}L${n(x + 5.2)} ${n(y + 5.2)}M${n(x + 5.2)} ${n(y - 5.2)}L${n(x - 5.2)} ${n(y + 5.2)}" style="opacity:.28"/>`;
    s += `<line class="dx-needle" data-needle x1="${n(x)}" y1="${n(y)}" x2="${n(x + r - 7)}" y2="${n(y)}" style="transform-origin:${n(x)}px ${n(y)}px"/>`;
    s += `<circle class="dx-hub" cx="${n(x)}" cy="${n(y)}" r="2.2"/>`;
    for (const rt of L.routes.filter((q) => q.from === part.id)) {
      const [ax, ay] = rt.points[0];
      const [bx, by] = rt.points[1];
      gate.needle[rt.key] = Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI);
    }
  } else {
    s += `<path class="dx-gate-mark" d="M${n(x)} ${n(y - 7)}V${n(y + 7)}M${n(x - 7)} ${n(y)}H${n(x + 7)}"/>`;
  }
  if (part.kind === "join") gate.ins = L.routes.filter((q) => q.to === part.id).map((q) => q.key);
  s += wordsOf(box);
  meta.gates[part.path] = gate;
  return s;
}

function event(box, part, model, meta) {
  const { x, y, w } = box;
  const r = w / 2;
  let s = halo(x, y, w, w, r);
  const end = part.kind === "end";
  if (!end) {
    s += `<circle class="dx-event" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = r - 3.4;
      const r2 = r - (i % 3 === 0 ? 6.6 : 5.2);
      s += `<line class="dx-tick" x1="${n(x + Math.cos(a) * r1)}" y1="${n(y + Math.sin(a) * r1)}" x2="${n(x + Math.cos(a) * r2)}" y2="${n(y + Math.sin(a) * r2)}"/>`;
    }
    s += `<path class="dx-gate-mark" d="M${n(x - 2.4)} ${n(y - 4)}L${n(x + 2.8)} ${n(y)}L${n(x - 2.4)} ${n(y + 4)}" style="stroke-width:1.5"/>`;
    meta.starts[part.path] = { x, y };
  } else {
    s += `<circle class="dx-event dx-end" cx="${n(x)}" cy="${n(y)}" r="${n(r - 1.5)}"/>`;
    s += `<text class="dx-done" data-count x="${n(x)}" y="${n(y + 3.6)}" text-anchor="middle">0</text>`;
    meta.ends[part.path] = { x, y };
  }
  return s + wordsOf(box);
}

function timer(box, part, model, meta) {
  const { x, y, w } = box;
  const r = w / 2;
  let s = halo(x, y, w, w, r);
  s += `<circle class="dx-event" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`;
  s += `<circle class="dx-event" cx="${n(x)}" cy="${n(y)}" r="${n(r - 3.4)}" style="stroke-width:.8"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r2 = r - (i % 3 === 0 ? 8.6 : 7);
    s += `<line class="dx-tick" x1="${n(x + Math.cos(a) * (r - 5))}" y1="${n(y + Math.sin(a) * (r - 5))}" x2="${n(x + Math.cos(a) * r2)}" y2="${n(y + Math.sin(a) * r2)}"/>`;
  }
  s += `<line class="dx-hand" data-hand x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - r + 8)}" style="transform-origin:${n(x)}px ${n(y)}px"/>`;
  s += `<circle class="dx-port-core" cx="${n(x)}" cy="${n(y)}" r="1.6"/>`;
  meta.timers[part.path] = { x, y, r };
  return s + wordsOf(box);
}

function store(box, part) {
  const { x, y, w, h } = box;
  const L = x - w / 2;
  const T = y - h / 2;
  const ry = 6;
  const band = (k) => T + ry + (k * (h - 2 * ry)) / 3;
  let s = halo(x, y, w, h, 8);
  s += `<path class="dx-store-body" d="M${n(L)} ${n(T + ry)}V${n(T + h - ry)}A${n(w / 2)} ${ry} 0 0 0 ${n(L + w)} ${n(T + h - ry)}V${n(T + ry)}"/>`;
  s += `<path class="dx-seam" d="M${n(L)} ${n(band(1))}A${n(w / 2)} ${ry} 0 0 0 ${n(L + w)} ${n(band(1))}M${n(L)} ${n(band(2))}A${n(w / 2)} ${ry} 0 0 0 ${n(L + w)} ${n(band(2))}"/>`;
  s += `<ellipse class="dx-store-top" cx="${n(x)}" cy="${n(T + ry)}" rx="${n(w / 2)}" ry="${ry}"/>`;
  return s + wordsOf(box);
}

/** The words the layout placed around a small part (it keeps routes off them). */
function wordsOf(box) {
  return (box.texts || []).map((t) => `<text class="dx-under${t.strong ? " dx-strong" : ""}" x="${n(t.x)}" y="${n(t.y)}" text-anchor="${t.anchor}">${esc(t.text)}</text>`).join("");
}

/** What a screen reader hears for a part. */
export function ariaOf(part, model) {
  const u = model.unit;
  const about = part.about ? ` ${part.about}` : "";
  switch (part.kind) {
    case "station":
      return part.inside
        ? `${part.label}: a step with its own process inside (${stepsInside(part.inside)} steps). Press Enter to open it.${about}`
        : `${part.label}: ${Number.isFinite(part.servers) ? (part.servers === 1 ? "one at a time" : `${part.servers} at a time`) : "no limit on how many at once"}, ${short(part.work, u)} each${part.fail ? (part.failLabel ? `, ${Math.round(part.fail * 100)}% ${part.failLabel}` : `, fails ${Math.round(part.fail * 100)}% of the time`) : ""}.${about}`;
    case "start":
      return `${part.label}: new work arrives${part.every != null ? ` every ${short(part.every, u)}` : " from the step that holds this process"}.${about}`;
    case "end":
      return `${part.label}: where work leaves${part.outcome ? ` as ${part.outcome}` : ""}.${about}`;
    case "choice":
      return `${part.label}: a decision; each item takes exactly one way out.${about}`;
    case "split":
      return `${part.label}: splits each item into parallel branches.${about}`;
    case "join":
      return `${part.label}: waits for every parallel branch, then goes on.${about}`;
    case "timer":
      return `${part.label}: holds each item ${short(part.wait, u)}.${about}`;
    case "store":
      return `${part.label}: a store the steps use.${about}`;
    default:
      return part.label;
  }
}

function partSvg(box, part, model, meta, L) {
  const k = part.kind;
  const inner = k === "station" ? station(box, part, model, meta, L) : k === "choice" || k === "split" || k === "join" ? gateway(box, part, model, meta, L) : k === "timer" ? timer(box, part, model, meta) : k === "store" ? store(box, part) : event(box, part, model, meta);
  const open = k === "station" && part.inside ? ` data-open="1"` : "";
  return `<g class="dx-part dx-${k}${k === "station" && part.inside ? " dx-opens" : ""}" data-path="${esc(part.path)}" tabindex="0" role="button" aria-label="${esc(ariaOf(part, model))}"${open}>${inner}</g>`;
}

// ---- routes and queues -------------------------------------------------------------------
const failish = (r) => r.when && r.when !== "ok" && r.when !== "else" && !r.when.startsWith("class:");

/** Distances along a polyline where it bends. */
function bendsOf(points) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < points.length - 1; i++) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    out.push(acc);
  }
  return out;
}

function routeSvg(rt, queueRoom) {
  let s = `<path class="dx-bed" d="${rt.d}"/><path class="dx-rail" d="${rt.d}"/>`;
  // direction chevrons, kept off the bends (the rail is rounded there) and off the queue
  const bends = bendsOf(rt.points);
  const stop = rt.length - Math.max(26, queueRoom);
  for (let at = 30; at < stop; at += 60) {
    if (bends.some((b) => Math.abs(b - at) < 16)) continue;
    const [cx, cy, a] = along(rt.points, at);
    const c = Math.cos(a);
    const si = Math.sin(a);
    const p = (dx, dy) => `${n(cx + dx * c - dy * si)} ${n(cy + dx * si + dy * c)}`;
    s += `<path class="dx-chev" d="M${p(-2.4, -2.6)}L${p(1.4, 0)}L${p(-2.4, 2.6)}"/>`;
  }
  const [ex, ey] = rt.points[rt.points.length - 1];
  const [px, py] = rt.points[rt.points.length - 2];
  const a = Math.atan2(ey - py, ex - px);
  const c = Math.cos(a);
  const si = Math.sin(a);
  const q = (dx, dy) => `${n(ex + dx * c - dy * si)} ${n(ey + dx * si + dy * c)}`;
  s += `<path class="dx-nib" d="M${q(-3.2, 0)}L${q(-9.5, -3.4)}L${q(-9.5, 3.4)}Z"/>`;
  return `<g class="dx-route${rt.back ? " dx-back" : ""}" data-key="${esc(rt.key)}"${failish(rt) ? ` data-fail="1"` : ""}>${s}</g>`;
}

/** A route's tag, drawn above the items so a busy route keeps its words readable. */
function tagSvg(rt) {
  if (!rt.label || !rt.labelAt) return "";
  const { x, y, w } = rt.labelAt;
  return `<g class="dx-tag" data-key="${esc(rt.key)}"${failish(rt) ? ` data-fail="1"` : ""}><rect x="${n(x - w / 2)}" y="${n(y - 7.5)}" width="${n(w)}" height="15" rx="7.5"/><text x="${n(x)}" y="${n(y + 3.4)}" text-anchor="middle">${esc(rt.label)}</text></g>`;
}

export const QUEUE_SLOTS = 6;
const SLOT0 = 16;
const SLOT = 9.5;

/** The route a station's queue forms on: the one entering its input side with the longest last run. */
export function feederOf(L, id) {
  const box = L.parts[id];
  const main = box.flip ? "e" : "w";
  const ins = L.routes.filter((r) => r.to === id);
  const run = (r) => {
    const a = r.points[r.points.length - 2];
    const b = r.points[r.points.length - 1];
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  };
  const pick = (rs) => rs.slice().sort((a, b) => run(b) - run(a))[0];
  return pick(ins.filter((r) => r.entry === main)) || pick(ins) || null;
}

function queueSvg(L, part, meta) {
  // a queue forms only where capacity is limited and there is room to wait
  if (!Number.isFinite(part.servers) || part.capacity === 0) return "";
  const rt = feederOf(L, part.id);
  if (!rt) return "";
  const a0 = rt.points[rt.points.length - 2];
  const a1 = rt.points[rt.points.length - 1];
  const run = Math.abs(a0[0] - a1[0]) + Math.abs(a0[1] - a1[1]);
  const room = rt.points.length > 2 ? run - L.options.radius - 2 : run - 8;
  const slots = [];
  let s = "";
  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const d = SLOT0 + i * SLOT;
    if (d > room) break;
    const [x, y, a] = along(rt.points, rt.length - d);
    slots.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    // a tick on the rail's outer side marks each place in the queue
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    s += `<line class="dx-slot" x1="${n(x + nx * 5)}" y1="${n(y + ny * 5)}" x2="${n(x + nx * 7.4)}" y2="${n(y + ny * 7.4)}"/>`;
  }
  // the overflow count sits above the middle of the queue, on the outer side of the rail
  const mid = slots[Math.floor((slots.length - 1) / 2)] || rt.points[rt.points.length - 1];
  const [, , a] = along(rt.points, rt.length - SLOT0);
  const horiz = Math.abs(Math.cos(a)) > 0.5;
  const more = horiz ? [mid[0], mid[1] - 9] : [mid[0] + 14, mid[1] + 3];
  s += `<text class="dx-more" data-qmore x="${n(more[0])}" y="${n(more[1])}" text-anchor="${horiz ? "middle" : "start"}"></text>`;
  meta.queues[part.path] = { slots, route: rt.key };
  return `<g class="dx-queue" data-queue="${esc(part.path)}">${s}</g>`;
}

// ---- the sheet -------------------------------------------------------------------
/**
 * One level's drawing from its layout. Returns { svg, meta, width, height }:
 * the markup, and the geometry the live page needs.
 */
export function sheetSvg(L, model, opts = {}) {
  const meta = { path: model.path, width: L.width, height: L.height, parts: {}, routes: {}, stations: {}, queues: {}, gates: {}, timers: {}, minis: {}, starts: {}, ends: {}, uses: [] };
  const W = L.width;
  const H = L.height;
  const uid = opts.uid || "0";
  const full = (id) => (model.path ? `${model.path}/${id}` : id);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${esc(opts.label || model.title || "process")}" data-level="${esc(model.path)}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<defs><pattern id="dx-dots-${uid}" width="12" height="12" patternUnits="userSpaceOnUse"><circle class="dx-dots" cx="1" cy="1" r=".8"/></pattern></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#dx-dots-${uid})"/>`;
  L.lanes.forEach((lane, i) => {
    s += `<rect class="dx-lane${i % 2 ? " dx-alt" : ""}" x="0" y="${n(lane.y)}" width="${W}" height="${n(lane.h)}"/>`;
    if (i > 0) s += `<line class="dx-lane-rule" x1="0" y1="${n(lane.y)}" x2="${W}" y2="${n(lane.y)}"/>`;
    if (lane.label) {
      const px = L.options.pad - 12;
      const pw = 26;
      s += `<rect class="dx-lane-plate" x="${n(px)}" y="${n(lane.y + 10)}" width="${pw}" height="${n(lane.h - 20)}" rx="6"/>`;
      s += `<text class="dx-lane-label" transform="translate(${n(px + pw / 2 + 3.6)} ${n(lane.y + lane.h / 2)}) rotate(-90)" text-anchor="middle" data-fit="${n(lane.h - 34)}" data-full="${esc(lane.label)}" data-size="10.5" data-min="8.5">${esc(fitText(lane.label, lane.h - 34, 10.5, 8.5).text)}</text>`;
    }
  });
  for (const u of L.uses) {
    s += `<path class="dx-use" data-use="${esc(full(u.from))}" d="${u.d}"/>`;
    meta.uses.push({ from: full(u.from), to: full(u.to) });
  }
  const queueRoom = (rt) => {
    const to = model.byId.get(rt.to);
    return to?.kind === "station" && Number.isFinite(to.servers) && to.capacity !== 0 ? SLOT0 + QUEUE_SLOTS * SLOT + 6 : 0;
  };
  for (const rt of L.routes) {
    s += routeSvg(rt, queueRoom(rt));
    meta.routes[rt.key] = { points: rt.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), length: Math.round(rt.length * 10) / 10, from: full(rt.from), to: full(rt.to) };
  }
  for (const p of model.parts.filter((q) => q.kind === "station")) s += queueSvg(L, p, meta);
  for (const p of model.parts) {
    const box = L.parts[p.id];
    s += partSvg(box, p, model, meta, L);
    meta.parts[p.path] = { x: box.x, y: box.y, w: box.w, h: box.h, kind: p.kind, flip: Boolean(box.flip) };
  }
  s += `<g class="dx-trails"></g><g class="dx-tokens"></g><g class="dx-tags">${L.routes.map(tagSvg).join("")}</g></svg>`;
  return { svg: s, meta, width: W, height: H };
}

/**
 * The framed card around the level sheets. The drawing's column holds the
 * level bar (shown inside a step: the path back and Close), the stage, and the
 * controls strip with the readout; the live page fills them.
 */
export function cardHtml({ id = "dx", fig = "Fig 1", title = "", sheets, hint = "", readout = "", caption = "", legend = [], theme = "auto" }) {
  const legendHtml = legend.length ? `<div class="dx-legend">${legend.map((l) => `<span><i style="background:${esc(l.color)}"></i>${esc(l.text)}</span>`).join("")}</div>` : "";
  return `<figure class="dx" id="${esc(id)}" data-theme="${esc(theme)}" data-layer="flow">
<div class="dx-card">
<header class="dx-head"><span class="dx-fig">${esc(fig)}</span><span class="dx-title">${esc(title)}</span></header>
<div class="dx-body">
<div class="dx-view">
<nav class="dx-levelbar" aria-label="Where you are" hidden><span class="dx-path"></span></nav>
<div class="dx-stage">${sheets.join("")}</div>
<div class="dx-dock"><span class="dx-keys" role="toolbar" aria-label="Playback and layers"></span><span class="dx-readout" data-readout>${esc(readout)}</span></div>
</div>
<aside class="dx-inspector"></aside>
</div>
<footer class="dx-foot"><span class="dx-hint">${esc(hint)}</span></footer>
<p class="dx-sr" aria-live="polite" data-say></p>
</div>
${caption ? `<figcaption class="dx-caption">${esc(caption)}</figcaption>` : ""}${legendHtml}
</figure>`;
}

/** A standalone page around one or more figures. */
export function pageHtml({ title, body, script = "", theme = "auto", lang = "en", head = "" }) {
  const bg = theme === "dark" ? THEMES.dark.paper : THEMES.light.paper;
  const dark = theme === "auto" ? `@media (prefers-color-scheme:dark){html,body{background:${THEMES.dark.paper}}}` : "";
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>html,body{margin:0;background:${bg}}${dark}body{padding:28px 16px}${css()}</style>
${head}</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;
}
