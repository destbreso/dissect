// A small shop's site during an HTTP flood, behind an edge network (a CDN such
// as Cloudflare, Akamai or Fastly), with the layers that keep it up: the
// edge's rules, a rate limit, a browser challenge, the cache, and an origin
// whose app servers scale. The reader turns the layers off and on, sets the
// size of the attack and of the crowd, and caps the autoscaling, and watches
// whether people still get their pages.
//
// The numbers are plausible, not measured: about 600 requests a second from
// people at a normal hour, seven in ten of them for assets (images, scripts,
// styles) the edge keeps, three in ten for pages the shop builds; a botnet of
// hijacked machines sending 10,000 a second for search pages with random words
// (which no cache holds); app servers that answer a batch of a hundred
// requests in a third of a second; a database with eight connections that does
// not scale. Each dot is a hundred requests that arrive and are served
// together, so a dot's time is the time of each request in it.

export default {
  id: "ddos",
  title: "A site under a DDoS attack",
  about: "A shop's site behind an edge network, flooded by a botnet from the 20th second. Each layer of the edge stops part of the attack before it costs the origin anything; the origin only has to carry what gets through. Each dot is a hundred requests.",
  item: "request",
  items: "requests",
  per: 100,
  unit: "s",
  seed: 1,
  horizon: 140,
  lanes: [
    { id: "net", label: "Internet" },
    { id: "edge", label: "Edge network" },
    { id: "origin", label: "Origin" },
  ],
  parts: [
    {
      id: "people",
      kind: "start",
      lane: "net",
      at: [0, 0],
      label: "people",
      every: "exp 0.1667",
      classes: { pages: 0.3, assets: 0.7 },
      about: "Shoppers' browsers, about 600 requests a second at a normal hour: three in ten for pages the shop builds for them (a product, the cart, a search), seven in ten for the images, scripts and styles those pages use.",
      dials: [{ label: "Traffic", value: 1, options: [{ label: "300/s", set: { every: "exp 0.3333" } }, { label: "600/s" }, { label: "1.2k/s", set: { every: "exp 0.0833" } }] }],
    },
    {
      id: "botnet",
      kind: "start",
      lane: "net",
      at: [0, 1],
      label: "botnet",
      every: "exp 0.01",
      first: 20,
      classes: { bots: 1 },
      about: "Thousands of hijacked machines, each sending a few requests a second, all for search pages with random words: no cache holds them, so each one is work for the origin. It starts at the 20th second.",
      dials: [
        {
          label: "Attack",
          value: 2,
          options: [{ label: "none", set: { paused: true } }, { label: "2k/s", set: { every: "exp 0.05" } }, { label: "10k/s" }, { label: "30k/s", set: { every: "exp 0.003333" } }],
        },
      ],
    },
    {
      id: "waf",
      kind: "station",
      lane: "edge",
      at: [1, 0],
      label: "WAF rules",
      glyph: "lock",
      servers: "inf",
      work: "const 0.002",
      fail: { bots: 0.6, else: 0.002 },
      failLabel: "blocked",
      switch: true,
      about: "Every request is checked against lists of addresses known to attack and against rules for known attack patterns. Six in ten of this botnet's requests come from addresses already on a list; one person in five hundred is blocked by mistake.",
    },
    {
      id: "limit",
      kind: "station",
      lane: "edge",
      at: [2, 0],
      label: "Rate limit",
      glyph: "gate",
      servers: "inf",
      work: "const 0.001",
      fail: { bots: 0.5, else: 0.001 },
      failLabel: "over the limit",
      switch: true,
      about: "No address may send more than 300 requests a minute. Half the bot requests that are left come from machines sending faster than that; a botnet spread over enough machines stays under it with the rest.",
    },
    {
      id: "challenge",
      kind: "station",
      lane: "edge",
      at: [3, 0],
      label: "Challenge",
      glyph: "check",
      switch: true,
      about: "A check in the browser before the site: a short test the page runs, or a puzzle. Whoever passes carries a cookie and goes straight through next time; scripts mostly fail it.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "request" },
          { id: "cookie", kind: "choice", at: [1, 0], label: "has a pass?", about: "Most page requests come from someone who passed already, and every asset comes after its page; almost no bot has a pass." },
          { id: "solve", kind: "station", at: [2, 1], label: "Solve it", glyph: "human", servers: "inf", work: "logn 3 9", fail: { bots: 0.97, else: 0.04 }, failLabel: "failed or gave up", about: "People take a few seconds, and one in twenty-five gives up. Scripts fail it, apart from the few that pay a service to solve it for them." },
          { id: "pass", kind: "end", at: [3, 0], label: "let through" },
          { id: "stopped", kind: "end", at: [3, 1], label: "stopped", outcome: "fail" },
        ],
        routes: [
          { from: "in", to: "cookie" },
          { id: "has", from: "cookie", to: "pass", p: { pages: 0.85, assets: 1, bots: 0.02 }, label: "has one" },
          { id: "new", from: "cookie", to: "solve", p: { pages: 0.15, assets: 0, bots: 0.98 }, label: "no pass" },
          { from: "solve", to: "pass", when: "ok", label: "" },
          { from: "solve", to: "stopped", when: "fail", label: "failed" },
        ],
      },
    },
    {
      id: "cache",
      kind: "choice",
      lane: "edge",
      at: [4, 0],
      label: "in the cache?",
      switch: { label: "Edge cache" },
      about: "The edge keeps assets close to people and answers nearly all of them here; a page is built for whoever asks, so almost every page goes on to the origin. The botnet's searches are never in it.",
    },
    { id: "edge-hit", kind: "end", lane: "edge", at: [4, 1], label: "served at the edge" },
    { id: "blocked", kind: "end", lane: "edge", at: [2, 1], label: "blocked", outcome: "fail" },
    { id: "lb", kind: "station", lane: "origin", at: [4, 0], label: "Load balancer", glyph: "balance", servers: "inf", work: "const 0.002", about: "Spreads what reaches the origin over the app servers that are up." },
    {
      id: "app",
      kind: "station",
      lane: "origin",
      at: [3, 0],
      label: "App servers",
      glyph: "server",
      servers: 2,
      work: "logn 0.3 0.8",
      patience: 10,
      scale: { min: 2, max: 16, target: 0.6, every: 10, boot: "uni 45 75", cooldown: 60 },
      about: "Each server answers a batch of a hundred requests in about a third of a second. Every 10 s the group looks at the work that came in and starts servers to keep them about 60% busy; a new one takes about a minute to boot. The edge gives up on a request that waits 10 s for the origin, and shows an error page.",
      dials: [{ label: "Autoscaling", value: 3, options: [{ label: "off", set: { scale: false } }, { label: "up to 4", set: { scale: { max: 4 } } }, { label: "up to 8", set: { scale: { max: 8 } } }, { label: "up to 16" }] }],
    },
    { id: "db", kind: "station", lane: "origin", at: [2, 0], label: "Database", glyph: "db", servers: 8, work: "logn 0.25 0.6", patience: 8, about: "Eight connections, a quarter of a second for a batch's queries. It does not scale: more app servers only send it more at once." },
    { id: "served", kind: "end", lane: "origin", at: [1, 0], label: "served" },
    { id: "timedout", kind: "end", lane: "origin", at: [1, 1], label: "timed out", outcome: "timeout" },
  ],
  routes: [
    { from: "people", to: "waf", latency: "uni 0.02 0.06" },
    { from: "botnet", to: "waf", latency: "uni 0.02 0.12" },
    { from: "waf", to: "limit", when: "ok", label: "" },
    { from: "waf", to: "blocked", when: "fail", label: "blocked" },
    { from: "limit", to: "challenge", when: "ok", label: "" },
    { from: "limit", to: "blocked", when: "fail", label: "too fast" },
    { from: "challenge", to: "cache", when: "ok", label: "" },
    { from: "challenge", to: "blocked", when: "fail", label: "failed" },
    { id: "hit", from: "cache", to: "edge-hit", p: { assets: 0.95, pages: 0.05, bots: 0 }, label: "hit" },
    { id: "miss", from: "cache", to: "lb", p: { assets: 0.05, pages: 0.95, bots: 1 }, label: "miss", bypass: true, latency: "uni 0.01 0.03" },
    { from: "lb", to: "app" },
    { from: "app", to: "db", when: "ok", label: "" },
    // the origin only times out when a layer is off, or the attack outgrows the edge
    { from: "app", to: "timedout", when: "timeout", label: "too slow", seldom: true },
    { from: "db", to: "served", when: "ok", label: "" },
    { from: "db", to: "timedout", when: "timeout", label: "too slow", seldom: true },
  ],
  claims: [
    { metric: "kind.bots.end.blocked", min: 0.985, say: "the edge stops 99% of the attack" },
    { metric: "kind.pages.outcome.ok", min: 0.98, say: "almost every page is served while the attack runs" },
    { metric: "app.maxServers", max: 4, say: "the origin never needs more than a server or two extra" },
  ],
};

// what the caption measures, from a run's log
const kindOf = (log) => new Map(log.filter((r) => r.k === "born").map((r) => [r.tok, r]));
/** Of one kind's items that arrived between from and to, the share that were served. */
function servedShare(log, kind, from = 0, to = Infinity) {
  const born = kindOf(log);
  let n = 0;
  let ok = 0;
  for (const r of log) {
    if (r.k !== "done") continue;
    const b = born.get(r.tok);
    if (!b || b.cls !== kind || b.t < from || b.t >= to) continue;
    n += 1;
    if (r.outcome === "ok") ok += 1;
  }
  return n ? ok / n : NaN;
}
/** Of one kind's items a station finished, the share it stopped. */
function stoppedAt(log, at, kind) {
  const born = kindOf(log);
  let n = 0;
  let stopped = 0;
  for (const r of log) {
    if (r.k !== "finish" || r.at !== at || born.get(r.tok)?.cls !== kind) continue;
    n += 1;
    if (r.outcome === "fail") stopped += 1;
  }
  return n ? stopped / n : NaN;
}
const mostServers = (log) => Math.max(2, ...log.filter((r) => r.k === "scale" && r.at === "app").map((r) => r.servers));
const pc = (v) => `${Math.round(v * 100)}%`;
const many = (v) => Math.round(v).toLocaleString("en-US");

export const figure = {
  fig: "Fig 15",
  // model time runs at a second a second; the page opens at 2x
  pace: 1,
  speed: 2,
  levelPace: { challenge: 1 },
  watch: { class: "pages", label: "pages served", window: 20 },
  caption: ({ run, sim, variant, model }) => {
    const botnet = model.parts.find((p) => p.id === "botnet");
    const rate = model.per / Number(botnet.every.split(" ")[1]);
    const span = model.horizon - botnet.first;
    const bots = run.kinds.bots;
    const reached = (st) => ((st.kinds.bots.done - (st.kinds.bots.ends.blocked ?? 0)) * model.per) / span;
    const off = (...ids) => ({ changes: ids.map((part) => ({ t: 0, part, set: { bypass: true } })) });
    const noChallenge = variant(null, off("challenge"));
    const noLimit = variant(null, off("challenge", "limit"));
    const firstMinute = servedShare(noChallenge.log, "pages", botnet.first, botnet.first + 60);
    const after = servedShare(noChallenge.log, "pages", botnet.first + 80, model.horizon);
    return (
      `From the ${botnet.first}th second a botnet sends ${many(rate)} requests a second, and the edge stops ${pc((bots.ends.blocked ?? 0) / bots.done)} of them before they cost the origin anything: ` +
      `the WAF's lists and rules stop ${pc(stoppedAt(sim.log, "waf", "bots"))}, the rate limit ${pc(stoppedAt(sim.log, "limit", "bots"))} of what is left, the challenge ${pc(stoppedAt(sim.log, "challenge", "bots"))} of the rest. ` +
      `About ${many(reached(run))} bot requests a second reach the origin, the app servers never need more than ${mostServers(sim.log)}, and ${pc(servedShare(sim.log, "pages"))} of pages are served. ` +
      `Turn the challenge off and ${many(reached(noChallenge))} a second get through: in the attack's first minute, while new servers boot, only ${pc(firstMinute)} of pages are served, until autoscaling has ${mostServers(noChallenge.log)} running` +
      `${after >= 0.995 ? " and serves them all" : ` and serves ${pc(after)}`}. Turn the rate limit off too, and ${mostServers(noLimit.log)} servers are not enough: ${pc(servedShare(noLimit.log, "pages", botnet.first))} of pages. ` +
      `Every layer turns off with the switch on it; click the botnet, the people or the app servers to set the attack, the crowd or the autoscaling.`
    );
  },
};
