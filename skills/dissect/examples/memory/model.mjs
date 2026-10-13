// A load, from the core down to the bits and back, in nanoseconds. Every
// level of the memory hierarchy is a machine you can open, down to the cells:
// in L1, the SRAM array, where a bit is a pair of cross-coupled inverters and
// a flip-flop latches what the sense amplifiers read; in DRAM, row activation,
// where a bit is a tiny capacitor that shares its charge with a bitline. The
// lesson is the hierarchy itself: almost every load is answered in about a
// nanosecond, the rare one that reaches DRAM takes some sixty, and that rare
// trip is a large part of the average. The clock slows as you open deeper
// levels. Numbers are those of a recent desktop core at 4 GHz: 32 KB L1 with
// two load ports, 12-cycle L2, about 11 ns of L3, DDR timings of 14 ns for tRP,
// tRCD and CL. Hit rates are those of a typical, cache-friendly program.

export default {
  id: "memory",
  title: "A load, from the core to the bits",
  item: "load",
  about: "A load asks for 8 bytes at an address. L1 answers almost always; when it cannot, the request goes down to L2, L3 and DRAM, and the 64-byte line it lands in comes back up.",
  unit: "ns",
  seed: 3,
  horizon: 400,
  lanes: [
    { id: "core", label: "Core" },
    { id: "mem", label: "Below L1" },
  ],
  parts: [
    { id: "load", kind: "start", lane: "core", at: [0, 0], label: "load", every: "exp 0.5", about: "The core issues about two loads a nanosecond." },
    { id: "ports", kind: "station", lane: "core", at: [1, 0], label: "Load ports", glyph: "gate", servers: 2, work: 0.25, about: "Two loads can start each cycle (0.25 ns); the cache behind them is pipelined." },
    {
      id: "l1",
      kind: "station",
      lane: "core",
      at: [2, 0],
      label: "L1 cache",
      glyph: "cache",
      servers: "inf",
      about: "32 KB of SRAM next to the core, 8 ways of 64 sets of 64-byte lines. About 4 cycles.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "address" },
          { id: "decode", kind: "station", at: [1, 0], label: "Decode set", glyph: "search", servers: "inf", work: 0.15, about: "Bits 6 to 11 of the address pick one of the 64 sets." },
          {
            id: "array",
            kind: "station",
            at: [2, 0],
            label: "SRAM array",
            glyph: "server",
            servers: "inf",
            about: "Rows of 6-transistor cells. Reading one is a sequence of small analog steps.",
            inside: {
              parts: [
                { id: "in", kind: "start", at: [0, 0], label: "row" },
                { id: "pre", kind: "station", at: [1, 0], label: "Precharge", glyph: "build", servers: "inf", work: 0.08, about: "Both bitlines of every column are charged to the supply voltage." },
                { id: "word", kind: "station", at: [2, 0], label: "Raise wordline", glyph: "gate", servers: "inf", work: 0.07, about: "The row's wordline opens the two access transistors of every cell in the row." },
                { id: "split", kind: "station", at: [3, 0], label: "Bitlines split", glyph: "network", servers: "inf", work: 0.12, about: "Each cell is a bit held by two cross-coupled inverters; the side holding 0 pulls its bitline down, by tens of millivolts." },
                { id: "sense", kind: "station", at: [3, 1], label: "Sense amps", glyph: "test", servers: "inf", work: 0.08, about: "One sense amplifier per column turns the small difference into a full 0 or 1." },
                { id: "latch", kind: "station", at: [2, 1], label: "Output latch", glyph: "lock", servers: "inf", work: 0.05, about: "A flip-flop captures each value on the clock edge and holds it for the next stage: 512 of them for a 64-byte line." },
                { id: "out", kind: "end", at: [1, 1], label: "64 bytes out" },
              ],
              routes: [
                { from: "in", to: "pre" },
                { from: "pre", to: "word" },
                { from: "word", to: "split" },
                { from: "split", to: "sense" },
                { from: "sense", to: "latch" },
                { from: "latch", to: "out" },
              ],
            },
          },
          { id: "tags", kind: "station", at: [3, 0], label: "Compare tags", glyph: "check", servers: "inf", work: 0.25, about: "The set's 8 stored tags are compared with the address's tag at once; the matching way's bytes are selected." },
          { id: "out", kind: "end", at: [4, 0], label: "looked up" },
        ],
        routes: [
          { from: "in", to: "decode" },
          { from: "decode", to: "array" },
          { from: "array", to: "tags" },
          { from: "tags", to: "out" },
        ],
      },
    },
    { id: "inl1", kind: "choice", lane: "core", at: [3, 0], label: "in L1?" },
    {
      id: "below",
      kind: "station",
      lane: "mem",
      at: [4, 0],
      label: "L2, L3, DRAM",
      glyph: "db",
      servers: 12,
      about: "A miss waits in one of 12 fill buffers while the line is fetched from further down.",
      inside: {
        lanes: [
          { id: "l2", label: "L2" },
          { id: "l3", label: "L3" },
          { id: "dram", label: "DRAM" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "l2", at: [0, 0], label: "L1 miss" },
          { id: "l2", kind: "station", lane: "l2", at: [1, 0], label: "L2 lookup", glyph: "cache", servers: 4, work: 3, about: "1 MB per core, about 12 cycles." },
          { id: "inl2", kind: "choice", lane: "l2", at: [2, 0], label: "in L2?" },
          { id: "l3", kind: "station", lane: "l3", at: [2, 0], label: "L3 lookup", glyph: "cache", servers: 8, work: "uni 9 13", about: "Shared by all cores, across the ring: about 11 ns." },
          { id: "inl3", kind: "choice", lane: "l3", at: [3, 0], label: "in L3?" },
          {
            id: "dram",
            kind: "station",
            lane: "dram",
            at: [4, 0],
            label: "DRAM",
            glyph: "db",
            servers: 8,
            about: "The memory controller sends the request to one of 8 banks. What happens there depends on which row the bank has open.",
            inside: {
              parts: [
                { id: "in", kind: "start", at: [0, 0], label: "request" },
                { id: "open", kind: "choice", at: [1, 0], label: "row open?" },
                { id: "pre", kind: "station", at: [2, 1], label: "Precharge", glyph: "build", servers: "inf", work: 14, about: "tRP: close the open row (its values go back into its cells) and precharge the bitlines." },
                {
                  id: "act",
                  kind: "station",
                  at: [3, 1],
                  label: "Activate row",
                  glyph: "gate",
                  servers: "inf",
                  about: "tRCD: bring one 8 KB row into the bank's sense amplifiers. Down here a bit is a capacitor.",
                  inside: {
                    parts: [
                      { id: "in", kind: "start", at: [0, 0], label: "row address" },
                      { id: "wl", kind: "station", at: [1, 0], label: "Raise wordline", glyph: "gate", servers: "inf", work: 3, about: "One wordline turns on the access transistor of every cell in the row: 65,536 cells at once." },
                      { id: "share", kind: "station", at: [2, 0], label: "Charge sharing", glyph: "network", servers: "inf", work: 3, about: "Each cell is a capacitor, charged for 1 and empty for 0. It shares its few femtocoulombs with a long bitline held at half the supply voltage, nudging it up or down by a few millivolts." },
                      { id: "sense", kind: "station", at: [3, 0], label: "Sense amps", glyph: "test", servers: "inf", work: 5, about: "The sense amplifiers swing each bitline to a full 0 or 1. The row is now in the row buffer." },
                      { id: "restore", kind: "station", at: [4, 0], label: "Restore cells", glyph: "wrench", servers: "inf", work: 3, about: "Reading drained the capacitors, so the amplified values are written back into the row." },
                      { id: "out", kind: "end", at: [5, 0], label: "row open" },
                    ],
                    routes: [
                      { from: "in", to: "wl" },
                      { from: "wl", to: "share" },
                      { from: "share", to: "sense" },
                      { from: "sense", to: "restore" },
                      { from: "restore", to: "out" },
                    ],
                  },
                },
                { id: "cas", kind: "station", at: [4, 0], label: "Read column", glyph: "doc", servers: "inf", work: 16, about: "CL and the burst: the column address picks 64 bytes in the row buffer and they cross the bus in 8 transfers." },
                { id: "out", kind: "end", at: [5, 0], label: "64 bytes back" },
              ],
              routes: [
                { from: "in", to: "open" },
                { id: "row-hit", from: "open", to: "cas", p: 0.55, label: "yes" },
                { id: "row-miss", from: "open", to: "pre", p: 0.45, label: "another row" },
                { from: "pre", to: "act" },
                { from: "act", to: "cas" },
                { from: "cas", to: "out" },
              ],
            },
          },
          { id: "out", kind: "end", lane: "l2", at: [5, 0], label: "line filled" },
        ],
        routes: [
          { from: "in", to: "l2" },
          { from: "l2", to: "inl2" },
          { id: "l2-hit", from: "inl2", to: "out", p: 0.6, label: "hit" },
          { id: "l2-miss", from: "inl2", to: "l3", p: 0.4, label: "miss" },
          { from: "l3", to: "inl3" },
          { id: "l3-hit", from: "inl3", to: "out", p: 0.5, label: "hit" },
          { id: "l3-miss", from: "inl3", to: "dram", p: 0.5, label: "miss", latency: 4 },
          { from: "dram", to: "out", latency: 4 },
        ],
      },
    },
    { id: "reg", kind: "end", lane: "core", at: [5, 0], label: "in a register" },
  ],
  routes: [
    { from: "load", to: "ports" },
    { from: "ports", to: "l1" },
    { from: "l1", to: "inl1" },
    { id: "l1-hit", from: "inl1", to: "reg", p: 0.95, label: "hit" },
    { id: "l1-miss", from: "inl1", to: "below", p: 0.05, label: "miss" },
    { from: "below", to: "reg" },
  ],
  claims: [
    { metric: "lead.p50", min: 0.8, max: 1.5, say: "a typical load takes about a nanosecond" },
    { metric: "lead.p99", min: 10, say: "the slowest loads take tens of nanoseconds" },
  ],
};

export const figure = {
  fig: "Fig 8",
  pace: 2,
  caption: ({ run, sim, fmt }) => {
    const born = new Map();
    const deep = new Set(sim.log.filter((r) => r.k === "enter" && r.station === "below/dram").map((r) => r.tok));
    const leads = [];
    const dramLeads = [];
    for (const r of sim.log) {
      if (r.k === "born") born.set(r.tok, r.t);
      if (r.k === "done") (deep.has(r.tok) ? dramLeads : leads).push(r.t - born.get(r.tok));
    }
    const all = leads.concat(dramLeads);
    const total = all.reduce((a, b) => a + b, 0);
    const dramTotal = dramLeads.reduce((a, b) => a + b, 0);
    const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    return `${run.done} loads in ${fmt(400)}: half are answered in ${fmt(run.p50Lead)} or less, nearly all by L1. ${dramLeads.length} of them (${((dramLeads.length / all.length) * 100).toFixed(1)}%) had to go all the way to DRAM and took ${fmt(med(dramLeads))} each at the median, so those few account for ${Math.round((dramTotal / total) * 100)}% of all the time spent loading. Open L1, then its SRAM array, to watch a bit being read; open the miss path down to DRAM's row activation for the other kind of bit.`;
  },
};
