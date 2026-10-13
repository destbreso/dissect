// How Dissect makes a figure: a day of requests, each one a process someone
// wants explained, from the description to the delivered page. The agent's
// steps follow SKILL.md's workflow: truth first, find the lesson, plan the
// floor, write the model, then build, audit and check until the figure passes
// and the agent, reading its pictures, finds nothing left to fix.
//
// Measured, on the author's machine (Apple Silicon, Node 22) over the shipped
// examples: a build lays out every level in 120 to 300 ms, validates the model
// in under a millisecond, draws the sheets in 0.3 to 3 ms, simulates in 2 to
// 100 ms and writes the page in tens of milliseconds; the audit adds 0.1 to 2 s;
// the browser check takes 17 to 49 s, five passes that each open Chrome and
// visit every level. Assumed: how long the agent takes for each of its steps,
// how often the audit, the check and the agent's own reading find something to
// fix, and a request about every 45 minutes. Each request has its own agent
// session and its own Chrome, so no request waits for another.

const sec = (median, p95) => `logn ${median / 60} ${p95 / 60}`;

export default {
  id: "making-a-figure",
  title: "How Dissect makes a figure",
  item: "figure",
  items: "figures",
  about: "You describe a process; the agent collects the numbers, finds the lesson, plans the floor and writes the model; the kit builds the page and audits it; headless Chrome checks it; the agent reads the pictures. Anything any of them finds goes back to the agent, and the figure goes around again.",
  unit: "min",
  seed: 17,
  horizon: 480,
  lanes: [
    { id: "you", label: "You" },
    { id: "agent", label: "Agent" },
    { id: "kit", label: "Kit" },
    { id: "chrome", label: "Chrome" },
  ],
  parts: [
    {
      id: "ask",
      kind: "start",
      lane: "you",
      at: [0, 0],
      label: "a process",
      every: "exp 45",
      about: "A pipeline, an architecture, a protocol, a human process: what it is, who works in it, and the numbers you know.",
    },
    {
      id: "model",
      kind: "station",
      lane: "agent",
      at: [1, 0],
      label: "Write the model",
      glyph: "code",
      about: "The agent turns the description into a model: lanes for the actors, stations with their servers and work times, choices with their odds, the claims the caption will make. Open it for the four steps.",
      inside: {
        lanes: [{ id: "steps", label: "" }],
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "a description" },
          {
            id: "truth",
            kind: "station",
            at: [1, 0],
            label: "Collect the numbers",
            glyph: "search",
            servers: "inf",
            work: "logn 4 12",
            about: "Truth first: how often work arrives, each step's median and p95, how many work at once, how often a step fails or sends work back. Yours when you have them; plausible ones otherwise, said so in the model and in the prose.",
          },
          {
            id: "lesson",
            kind: "station",
            at: [2, 0],
            label: "Find the lesson",
            glyph: "review",
            servers: "inf",
            work: "logn 2 6",
            about: "What the reader did not see: where the time really goes, what happens under load, what one change does. It decides which what-if proves it and which step the caption points at.",
          },
          {
            id: "floor",
            kind: "station",
            at: [3, 0],
            label: "Plan the floor",
            glyph: "doc",
            servers: "inf",
            work: "logn 2 5",
            about: "Lanes are the actors, top to bottom; columns run left to right in time. Three to seven steps a level, and the detail pushed into steps that open.",
          },
          {
            id: "write",
            kind: "station",
            at: [4, 0],
            label: "Write it",
            glyph: "code",
            servers: "inf",
            work: "logn 8 20",
            about: "model.mjs: every part and route, an about on every step a reader will click, the claims, and a caption function that writes the caption from the run.",
          },
          { id: "out", kind: "end", at: [5, 0], label: "model.mjs" },
        ],
        routes: [
          { from: "in", to: "truth" },
          { from: "truth", to: "lesson" },
          { from: "lesson", to: "floor" },
          { from: "floor", to: "write" },
          { from: "write", to: "out" },
        ],
      },
    },
    {
      id: "build",
      kind: "station",
      lane: "kit",
      at: [2, 0],
      label: "Build",
      glyph: "build",
      about: "build.mjs turns the model into one HTML page with the runtime inlined: no network, no build step. Open it for its four steps.",
      inside: {
        lanes: [{ id: "steps", label: "" }],
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "model.mjs" },
          { id: "validate", kind: "station", at: [1, 0], label: "Validate", glyph: "check", servers: "inf", work: sec(0.0001, 0.0002), about: "Every part, route, odd and duration is checked, with an error that names what is wrong and where." },
          { id: "lay", kind: "station", at: [2, 0], label: "Lay out", glyph: "network", servers: "inf", work: sec(0.2, 0.3), about: "A floor plan for every level: columns sized to their parts, and every route picked by cost, never through a part or over words; then the SVG sheets, one bay per server and one tick per place in a queue, which take about a millisecond more. Most of the build is here." },
          { id: "run", kind: "station", at: [3, 0], label: "Simulate", glyph: "service", servers: "inf", work: sec(0.02, 0.1), about: "The seeded discrete-event simulation, one random stream per part, and the runs the caption's variants need." },
          { id: "page", kind: "station", at: [4, 0], label: "Write the page", glyph: "browser", servers: "inf", work: sec(0.02, 0.06), about: "The page, its caption written from the run, and the runtime that replays the simulator's log." },
          { id: "out", kind: "end", at: [5, 0], label: "page.html" },
        ],
        routes: [
          { from: "in", to: "validate" },
          { from: "validate", to: "lay" },
          { from: "lay", to: "run" },
          { from: "run", to: "page" },
          { from: "page", to: "out" },
        ],
      },
    },
    {
      id: "audit",
      kind: "station",
      lane: "kit",
      at: [3, 0],
      label: "Audit",
      glyph: "check",
      servers: "inf",
      work: sec(0.25, 1.8),
      fail: 0.2,
      failLabel: "found a problem",
      about: "The model, the floor plan and the run on the figure's seed and seven more: every route taken, the claims true on all eight, the step that matters busy enough to show a queue.",
    },
    {
      id: "fix",
      kind: "station",
      lane: "agent",
      at: [3, 0],
      label: "Fix it",
      glyph: "wrench",
      servers: "inf",
      work: "logn 4 12",
      about: "The agent fixes what was found: a number, a route, a word that does not fit, a caption that says more than the run shows. Then the figure goes around again.",
    },
    {
      id: "check",
      kind: "station",
      lane: "chrome",
      at: [4, 0],
      label: "Check",
      glyph: "browser",
      about: "check.mjs measures the page in headless Chrome, and reports every error at the end. Open it for its passes.",
      inside: {
        lanes: [{ id: "passes", label: "" }],
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "page.html" },
          { id: "desk", kind: "station", at: [1, 0], label: "Desktop", glyph: "browser", servers: "inf", work: sec(8, 18), about: "Every level opened at desktop width, in the light theme and then the dark: words inside their plates and clear of rails, parts and tags; WCAG contrast on everything; a picture of each level." },
          { id: "wide", kind: "station", at: [2, 0], label: "A wide font", glyph: "doc", servers: "inf", work: sec(4, 9), about: "The same with Verdana or DejaVu Sans, which are wider than the fonts most readers have: a word that fits only on a Mac fails here." },
          { id: "phone", kind: "station", at: [3, 0], label: "A phone", glyph: "phone", servers: "inf", work: sec(2, 5), about: "390 px wide: the figure pans inside its frame, and the page never scrolls sideways." },
          { id: "drive", kind: "station", at: [4, 0], label: "A drive", glyph: "robot", servers: "inf", work: sec(2, 4), about: "The figure plays, follows an item, takes a what-if, and a switch turns off and back on." },
          { id: "clear", kind: "choice", at: [5, 0], label: "all clear?" },
          { id: "ok", kind: "end", at: [6, 0], label: "passed" },
          { id: "bad", kind: "end", at: [6, 1], label: "errors", outcome: "fail" },
        ],
        routes: [
          { from: "in", to: "desk" },
          { from: "desk", to: "wide" },
          { from: "wide", to: "phone" },
          { from: "phone", to: "drive" },
          { from: "drive", to: "clear" },
          { from: "clear", to: "ok", p: 0.7, label: "" },
          { from: "clear", to: "bad", p: 0.3, label: "" },
        ],
      },
    },
    {
      id: "read",
      kind: "station",
      lane: "agent",
      at: [4, 0],
      label: "Read the pictures",
      glyph: "review",
      servers: "inf",
      work: "logn 3 8",
      fail: 0.15,
      failLabel: "something to fix",
      about: "Verify like a critic: the agent reads every picture the check made, opens every window, follows an item to its end and runs the what-if the caption promises. Some things only a reader catches: a layout that misleads, a caption that says more than the run.",
    },
    { id: "done", kind: "end", lane: "you", at: [4, 0], label: "your figure" },
  ],
  routes: [
    { from: "ask", to: "model" },
    { from: "model", to: "build" },
    { from: "build", to: "audit" },
    { from: "audit", to: "check", when: "ok", label: "passed" },
    { from: "audit", to: "fix", when: "fail", label: "a problem" },
    { from: "check", to: "read", when: "ok", label: "clear" },
    { from: "check", to: "fix", when: "fail", label: "errors" },
    { from: "read", to: "done", when: "ok", label: "" },
    { from: "read", to: "fix", when: "fail", label: "not yet" },
    { from: "fix", to: "build" },
  ],
  claims: [
    { metric: "lead.p50", min: 20, max: 50, say: "a figure takes about half an hour from the request to the page" },
    { metric: "check.failShare", min: 0.15, max: 0.45, say: "the check sends about three pages in ten back to the agent" },
  ],
};

// what the caption measures, from a run's log: how many figures go around again, and who sent them back
function loopsOf(log) {
  const visits = new Map();
  const from = {};
  for (const r of log) {
    if (r.k !== "move" || r.at !== "fix") continue;
    visits.set(r.tok, (visits.get(r.tok) || 0) + 1);
    from[r.from] = (from[r.from] || 0) + 1;
  }
  const done = new Set(log.filter((r) => r.k === "done").map((r) => r.tok));
  const finished = log.filter((r) => r.k === "born" && r.at === "ask" && done.has(r.tok)).map((r) => r.tok);
  const again = finished.filter((t) => visits.has(t)).length / Math.max(1, finished.length);
  const rounds = finished.reduce((a, t) => a + (visits.get(t) || 0) + 1, 0) / Math.max(1, finished.length);
  const sent = Object.values(from).reduce((a, b) => a + b, 0);
  const [top, n] = Object.entries(from).sort((a, b) => b[1] - a[1])[0] || ["check", 0];
  return { again, rounds, top, topShare: sent ? n / sent : 0 };
}
// the time a step that opens spends on an item: the work of the steps inside it (nothing waits in there)
const inside = (S, path) => Object.entries(S).filter(([p]) => p.startsWith(`${path}/`)).reduce((a, [, s]) => a + (s.meanWork ?? 0), 0);

export const figure = {
  fig: "Fig 16",
  caption: ({ run, sim, fmt }) => {
    const S = run.stations;
    const build = inside(S, "build");
    const check = inside(S, "check");
    const kit = build * S.build.finished + (S.audit.meanWork ?? 0) * S.audit.finished + check * S.check.finished;
    const share = kit / (run.meanLead * run.done);
    const { again, rounds, top, topShare } = loopsOf(sim.log);
    const who = { audit: "the audit", check: "the check in Chrome", read: "the agent's own reading" }[top] ?? top;
    return (
      `On this day a figure takes ${fmt(run.p50Lead)} from the request to the page at the median, and ${fmt(run.p95Lead)} for the slowest 5%. ` +
      `Almost all of it is the agent's work: writing the model, then fixing what is found. The kit's build, audit and check are ${share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`} of the time: about ${fmt(build)}, ${fmt(S.audit.meanWork)} and ${fmt(check)} a round. ` +
      `${Math.round(again * 100)}% of the figures go around again at least once, ${rounds.toFixed(1)} rounds each on average, and ${who} sends back the most, ${Math.round(topShare * 100)}% of the returns. ` +
      `Open Write the model, Build and Check for their steps, and follow a figure to see its rounds.`
    );
  },
};
