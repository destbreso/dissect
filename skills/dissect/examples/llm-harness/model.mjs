// An LLM and its harness. The model is the brain, and it stays closed here: a
// box that can generate a number of replies at once (its batch slots on the
// GPUs) and takes as long as reading the prompt and writing the reply take.
// Everything around it is the harness, and that is the figure: the gateway,
// building the context (history and the system prompt, documents retrieved
// for the question, images prepared and voice transcribed for a multimodal
// model), the loop in which the model asks for a tool and the harness runs it
// and hands the result back for another turn, and the check on the way out.
// The lesson: the model is most of the time, and the harness decides how much
// model time a request needs, because every tool call is another full trip
// through the model; the batch slots are where requests wait when traffic
// rises. Numbers: about four messages a second, replies of 2 to 6 seconds,
// three requests in ten that call at least one tool.

export default {
  id: "llm-harness",
  title: "A message to an LLM, and its harness",
  item: "request",
  about: "The model reads a prompt and writes a reply. Everything else, from who is asking to what the reply may contain, is the harness around it.",
  unit: "ms",
  seed: 4,
  horizon: 60000,
  lanes: [
    { id: "client", label: "Client" },
    { id: "harness", label: "Harness" },
    { id: "model", label: "Model" },
    { id: "tools", label: "Tools" },
  ],
  parts: [
    { id: "user", kind: "start", lane: "client", at: [0, 0], label: "a message", every: "exp 250", classes: { text: 0.7, image: 0.2, voice: 0.1 }, about: "About four messages a second: most typed, one in five with an image, one in ten spoken." },
    { id: "gateway", kind: "station", lane: "client", at: [1, 0], label: "Gateway", glyph: "gate", servers: "inf", work: "logn 4 12", about: "Checks the API key, applies the rate limit for the account, and picks a region with capacity." },
    {
      id: "context",
      kind: "station",
      lane: "harness",
      at: [1, 0],
      label: "Build context",
      glyph: "doc",
      servers: "inf",
      about: "Everything the model will read: the system prompt and the conversation so far, documents found for the question, and the attachments in a form the model takes. The three are fetched side by side.",
      inside: {
        lanes: [
          { id: "prep", label: "Prepare" },
          { id: "store", label: "Stores" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "prep", at: [0, 0], label: "message" },
          { id: "fan", kind: "split", lane: "prep", at: [1, 0], label: "side by side" },
          {
            id: "attach",
            kind: "station",
            lane: "prep",
            at: [2, -1],
            label: "Attachments",
            glyph: "doc",
            servers: "inf",
            about: "Images and voice, turned into what the model takes.",
            inside: {
              parts: [
                { id: "in", kind: "start", at: [0, 0], label: "message" },
                { id: "kind", kind: "choice", at: [1, 0], label: "attached" },
                { id: "image", kind: "station", at: [2, -1], label: "Prepare image", glyph: "doc", servers: "inf", work: "logn 40 120", about: "Decode, resize to the resolution the model's vision input expects, strip metadata." },
                { id: "voice", kind: "station", at: [2, 1], label: "Transcribe", glyph: "phone", servers: "inf", work: "logn 400 1200", about: "Speech to text, so the model reads what was said (a model with audio input would take it as it is)." },
                { id: "ready", kind: "end", at: [3, 0], label: "ready" },
              ],
              routes: [
                { from: "in", to: "kind" },
                { id: "has-image", from: "kind", to: "image", when: "class:image", label: "image" },
                { id: "has-voice", from: "kind", to: "voice", when: "class:voice", label: "voice" },
                { id: "text-only", from: "kind", to: "ready", when: "class:text", label: "none" },
                { from: "image", to: "ready" },
                { from: "voice", to: "ready" },
              ],
            },
          },
          { id: "history", kind: "station", lane: "prep", at: [2, 0], label: "History", glyph: "queue", servers: "inf", work: "logn 3 10", uses: ["memory"], about: "The system prompt and the conversation so far, from the conversation store." },
          { id: "retrieve", kind: "station", lane: "prep", at: [2, 1], label: "Retrieve", glyph: "search", servers: "inf", work: "logn 60 200", uses: ["index"], about: "Embed the question, find the closest passages in a vector index, rerank them, keep the best few: retrieval-augmented generation." },
          { id: "meet", kind: "join", lane: "prep", at: [3, 0], label: "all three" },
          { id: "assemble", kind: "station", lane: "prep", at: [4, 0], label: "Assemble", glyph: "build", servers: "inf", work: "logn 2 6", about: "Tokenize, count, cut to the context window, and keep the stable prefix first so the model's prompt cache can reuse it." },
          { id: "prompt", kind: "end", lane: "prep", at: [5, 0], label: "prompt" },
          { id: "memory", kind: "store", lane: "store", at: [1.5, 0], label: "conversations" },
          { id: "index", kind: "store", lane: "store", at: [2.5, 0], label: "vector index" },
        ],
        routes: [
          { from: "in", to: "fan" },
          { from: "fan", to: "attach" },
          { from: "fan", to: "history" },
          { from: "fan", to: "retrieve" },
          { from: "attach", to: "meet" },
          { from: "history", to: "meet" },
          { from: "retrieve", to: "meet" },
          { from: "meet", to: "assemble" },
          { from: "assemble", to: "prompt" },
        ],
      },
    },
    { id: "llm", kind: "station", lane: "model", at: [2, 0], label: "LLM", glyph: "robot", servers: 16, work: "logn 1800 6000", about: "The brain, closed: it can generate 16 replies at once (its batch on the GPUs). Its time is reading the prompt, then writing the reply token by token: two seconds at the median, six on a long answer." },
    { id: "act", kind: "choice", lane: "model", at: [3, 0], label: "asks for a tool?" },
    {
      id: "tool",
      kind: "station",
      lane: "tools",
      at: [2, 0],
      label: "Run the tool",
      glyph: "wrench",
      servers: "inf",
      about: "The model does not run anything: it writes a call (a name and arguments), the harness runs it, and the result goes back to the model as a new message.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "tool call" },
          { id: "which", kind: "choice", at: [1, 0], label: "which tool" },
          { id: "search", kind: "station", at: [2, -1], label: "Web search", glyph: "network", servers: "inf", work: "logn 600 1800", about: "Query a search API and fetch the top pages as text." },
          { id: "code", kind: "station", at: [2, 0], label: "Run code", glyph: "code", servers: 8, work: "logn 300 2500", about: "In a sandbox with no network: eight run at once." },
          { id: "db", kind: "station", at: [2, 1], label: "Query data", glyph: "db", servers: "inf", work: "logn 40 300", about: "A read-only query against the user's own data, with their permissions." },
          { id: "result", kind: "end", at: [3, 0], label: "result" },
        ],
        routes: [
          { from: "in", to: "which" },
          { id: "use-search", from: "which", to: "search", p: 0.5, label: "search" },
          { id: "use-code", from: "which", to: "code", p: 0.3, label: "code" },
          { id: "use-db", from: "which", to: "db", p: 0.2, label: "data" },
          { from: "search", to: "result" },
          { from: "code", to: "result" },
          { from: "db", to: "result" },
        ],
      },
    },
    { id: "check", kind: "station", lane: "harness", at: [4, 0], label: "Output check", glyph: "lock", servers: "inf", work: "logn 30 90", fail: 0.01, failLabel: "blocked", about: "A classifier and rules read the reply before it leaves: policy, leaked secrets, a tool result that should not be quoted." },
    { id: "reply", kind: "end", lane: "client", at: [5, 0], label: "reply streamed" },
    { id: "refusal", kind: "end", lane: "client", at: [5, 1], label: "refusal" },
  ],
  routes: [
    { from: "user", to: "gateway", latency: "uni 20 60" },
    { from: "gateway", to: "context" },
    { from: "context", to: "llm" },
    { from: "llm", to: "act" },
    { id: "call", from: "act", to: "tool", p: 0.3, label: "tool call" },
    { id: "answer", from: "act", to: "check", p: 0.7, label: "answer" },
    { id: "result", from: "tool", to: "llm", label: "result" },
    { from: "check", to: "reply", when: "ok", label: "", latency: "uni 20 60" },
    { id: "blocked", from: "check", to: "refusal", when: "fail", label: "" },
  ],
  claims: [
    { metric: "llm.utilization", min: 0.5, max: 0.92, say: "the model's batch is busy but keeps up" },
    { metric: "lead.p50", min: 2000, max: 6000, say: "a reply takes a few seconds" },
  ],
};

export const figure = {
  fig: "Fig 11",
  caption: ({ run, day, sim, fmt }) => {
    const born = new Map(sim.log.filter((r) => r.k === "born").map((r) => [r.tok, r.t]));
    // model time against everything else, over every request; and how many model turns a request took
    let model = 0;
    const turns = new Map();
    for (const r of sim.log)
      if (r.k === "start" && r.at === "llm") {
        model += r.t1 - r.t;
        turns.set(r.tok, (turns.get(r.tok) || 0) + 1);
      }
    const total = run.meanLead * run.done;
    const multi = [...turns.values()].filter((n) => n > 1).length;
    const one = sim.log.filter((r) => r.k === "done" && r.at === "reply" && turns.get(r.tok) === 1).map((r) => r.t - born.get(r.tok)).sort((a, b) => a - b);
    const more = sim.log.filter((r) => r.k === "done" && r.at === "reply" && turns.get(r.tok) > 1).map((r) => r.t - born.get(r.tok)).sort((a, b) => a - b);
    const med = (xs) => xs[Math.floor(xs.length / 2)];
    return `A reply takes ${fmt(run.p50Lead)} at the median, and ${Math.round((model / total) * 100)}% of all the time is the model writing. The harness decides how much of it a request needs: the ${multi} requests that called a tool went through the model more than once and took ${fmt(med(more))} at the median, against ${fmt(med(one))} for a single turn. The model's 16 slots are busy ${Math.round(day.stations.llm.utilization * 100)}% of the minute; give the client a burst and requests start waiting for one.`;
  },
};
