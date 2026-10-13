// Incident response, a human process. Alerts page the on-call engineer, one
// person, who looks at each one. Four alerts in five need nothing (a flapping
// check, a threshold set too tight), but telling them apart takes the same
// look. An alert nobody has picked up after 15 minutes escalates to the
// secondary on-call. Real problems are fixed by the owning team, or, for the
// worst, in a war room where mitigation and the status page run side by side.
// The lesson is alert fatigue: noise uses the on-call's time, real problems
// wait behind it, and some escalate only because the on-call was busy with
// noise. Remove half the noise on "alert fires" and watch the waits shrink.
// Numbers: a noisy twelve-hour shift, five alerts an hour, eight minutes to
// look at one at the median. Seed 10 is the day closest to the median of 15.

export default {
  id: "incident-response",
  title: "An alert, from page to resolved",
  item: "alert",
  about: "The on-call engineer looks at every alert, one at a time. Most turn out to be noise; the real ones go to the team that owns the system, or to a war room when they are bad.",
  unit: "min",
  seed: 10,
  horizon: 720,
  lanes: [
    { id: "mon", label: "Monitoring" },
    { id: "oncall", label: "On-call" },
    { id: "team", label: "Team" },
  ],
  parts: [
    { id: "alert", kind: "start", lane: "mon", at: [0, 0], label: "alert fires", every: "exp 12", classes: { noise: 0.8, real: 0.2 }, about: "About five alerts an hour on a bad shift. Four in five need nothing; nobody knows which until someone looks." },
    { id: "look", kind: "station", lane: "oncall", at: [1, 0], label: "On-call looks", glyph: "human", servers: 1, work: "logn 8 25", patience: 15, about: "One engineer: acknowledge, open the dashboards, decide. About 8 minutes at the median, noise or not. An alert still waiting after 15 minutes escalates." },
    { id: "second", kind: "station", lane: "oncall", at: [1, 1], label: "Secondary", glyph: "human", servers: 1, work: "logn 10 30", about: "The second engineer on the rota, paged when the first has not answered in time." },
    { id: "noise", kind: "end", lane: "mon", at: [3, 0], label: "false alarm" },
    { id: "bad", kind: "choice", lane: "team", at: [2, 0], label: "how bad?" },
    { id: "fix", kind: "station", lane: "team", at: [3, 0], label: "Owner fixes", glyph: "wrench", servers: "inf", work: "logn 40 120", about: "The team that owns the system finds the cause and ships a fix: forty minutes at the median." },
    {
      id: "warroom",
      kind: "station",
      lane: "team",
      at: [3, 1],
      label: "War room",
      glyph: "team",
      servers: "inf",
      about: "For the worst quarter of real incidents: an incident commander, people on mitigation and someone on the status page, all at once.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "declared" },
          { id: "both", kind: "split", at: [1, 0], label: "at once" },
          { id: "mitigate", kind: "station", at: [2, -1], label: "Mitigate", glyph: "wrench", servers: "inf", work: "logn 45 150", about: "Roll back, fail over, shed load: stop the damage first, find the cause later." },
          { id: "status", kind: "station", at: [2, 1], label: "Status page", glyph: "doc", servers: "inf", work: "logn 20 60", about: "Tell the customers what is happening, and keep telling them." },
          { id: "meet", kind: "join", at: [3, 0], label: "both done" },
          { id: "out", kind: "end", at: [4, 0], label: "mitigated" },
        ],
        routes: [
          { from: "in", to: "both" },
          { from: "both", to: "mitigate" },
          { from: "both", to: "status" },
          { from: "mitigate", to: "meet" },
          { from: "status", to: "meet" },
          { from: "meet", to: "out" },
        ],
      },
    },
    { id: "resolved", kind: "end", lane: "team", at: [4, 0], label: "resolved" },
  ],
  routes: [
    { from: "alert", to: "look" },
    { id: "escalate", from: "look", to: "second", when: "timeout", label: "15 min, no answer" },
    { id: "dismiss", from: "look", to: "noise", when: "class:noise", label: "noise" },
    { id: "real", from: "look", to: "bad", when: "class:real", label: "real" },
    { id: "dismiss-2", from: "second", to: "noise", when: "class:noise", label: "" },
    { id: "real-2", from: "second", to: "bad", when: "class:real", label: "" },
    { id: "minor", from: "bad", to: "fix", p: 0.75, label: "contained" },
    { id: "major", from: "bad", to: "warroom", p: 0.25, label: "customers hit" },
    { from: "fix", to: "resolved" },
    { from: "warroom", to: "resolved" },
  ],
  claims: [
    { metric: "look.utilization", min: 0.35, max: 0.85, say: "the on-call spends a large part of the shift looking at alerts" },
    { metric: "look.timeoutShare", max: 0.3, say: "escalation is the exception, not the rule" },
  ],
};

export const figure = {
  fig: "Fig 9",
  caption: ({ run, day, sim, variant, fmt }) => {
    const cls = new Map(sim.log.filter((r) => r.k === "born").map((r) => [r.tok, r.cls]));
    const looks = sim.log.filter((r) => r.k === "start" && r.at === "look");
    const noiseShare = looks.filter((r) => cls.get(r.tok) === "noise").length / looks.length;
    const escalated = sim.log.filter((r) => r.k === "renege" && r.at === "look").length;
    const waitOf = (log) => {
      const c = new Map(log.filter((r) => r.k === "born").map((r) => [r.tok, r.cls]));
      const q = new Map();
      const w = [];
      for (const r of log) {
        if (r.k === "queue" && r.at === "look") q.set(r.tok, r.t);
        if ((r.k === "start" || r.k === "renege") && r.at === "look" && c.get(r.tok) === "real") w.push(r.t - q.get(r.tok));
      }
      return w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);
    };
    const calm = variant((m) => {
      const a = m.parts.find((p) => p.id === "alert");
      a.classes = { noise: 0.4, real: 0.2 };
      a.every = "exp 20";
    });
    return `The on-call engineer is busy ${Math.round(day.stations.look.utilization * 100)}% of the shift, and ${Math.round(noiseShare * 100)}% of the alerts they look at turn out to be noise. A real problem waits ${fmt(waitOf(sim.log))} on average before anyone looks at it, and ${escalated} alerts escalated to the secondary only because the first engineer was still busy. With half the noise gone, a real problem would wait ${fmt(waitOf(calm.log))}. Try "Half the noise" on alert fires.`;
  },
};
