// A CUDA kernel, warp by warp, in microseconds. The host launches a grid of
// 160 blocks of 128 threads: 640 warps of 32 threads that run in lockstep
// (SIMT). The block scheduler places blocks on the GPU's 40 SMs as they have
// room; this kernel's registers and shared memory leave room for 8 of its
// warps per SM, 320 in flight at once (its occupancy), and the rest wait.
// Open the resident warps to see a warp's life: it reads a tile from global
// memory and waits half a microsecond for it (hundreds of cycles), computes on
// it for a fraction of that, eight times, then stores its results. The SM does
// not wait with it: while a warp waits for memory, the warp schedulers issue
// instructions for other warps. That is latency hiding, and it is why a
// memory-bound kernel's speed is set by how many warps can wait at once, not
// by its arithmetic. Halve the resident warps and watch the kernel slow down.
// Numbers: a mid-range GPU (40 SMs, 4 schedulers each), GDDR latency.

export default {
  id: "cuda",
  title: "A CUDA kernel, warp by warp",
  item: "warp",
  about: "A grid of thread blocks, split into warps of 32 threads, scheduled onto the GPU's streaming multiprocessors. Each warp alternates between waiting for memory and computing.",
  unit: "µs",
  seed: 1,
  horizon: 2,
  lanes: [
    { id: "host", label: "Host" },
    { id: "gpu", label: "GPU" },
  ],
  parts: [
    { id: "launch", kind: "start", lane: "host", at: [0, 0], label: "launch", every: 0.002, count: 640, about: "kernel<<<160, 128>>>: 160 blocks of 128 threads, 640 warps. The call returns at once; the GPU works on its own." },
    { id: "sched", kind: "station", lane: "gpu", at: [1, 0], label: "Block scheduler", glyph: "queue", servers: "inf", work: 0.05, about: "Hands blocks to the SMs that have room. A block's four warps go to the same SM and stay there until they finish." },
    {
      id: "sm",
      kind: "station",
      lane: "gpu",
      at: [2, 0],
      label: "Resident warps",
      glyph: "server",
      servers: 320,
      about: "40 SMs with room for 8 of this kernel's warps each: 320 warps in flight. Room is set by the registers and shared memory every thread needs.",
      inside: {
        lanes: [
          { id: "warp", label: "Warp" },
          { id: "mem", label: "Memory" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "warp", at: [0, 0], label: "on an SM" },
          { id: "load", kind: "timer", lane: "mem", at: [1, 0], label: "Global load", wait: "uni 0.4 0.6", about: "A read of a tile from global memory: about half a microsecond, hundreds of cycles. The warp can do nothing until it arrives." },
          { id: "math", kind: "station", lane: "warp", at: [2, 0], label: "Compute", glyph: "build", servers: 160, work: 0.08, about: "Each SM has 4 warp schedulers; each issues an instruction for one ready warp per cycle, and the warp's 32 threads run it together on their own data. 160 schedulers in all." },
          { id: "more", kind: "choice", lane: "warp", at: [3, 0], label: "more tiles?" },
          { id: "store", kind: "timer", lane: "mem", at: [4, 0], label: "Store results", wait: 0.3, about: "The results go back to global memory." },
          { id: "out", kind: "end", lane: "warp", at: [5, 0], label: "warp done" },
        ],
        routes: [
          { from: "in", to: "load" },
          { from: "load", to: "math" },
          { from: "math", to: "more" },
          { id: "next-tile", from: "more", to: "load", when: "ok", max: 7, label: "8 tiles" },
          { id: "finish", from: "more", to: "store", when: "ok", label: "" },
          { from: "store", to: "out" },
        ],
      },
    },
    { id: "done", kind: "end", lane: "host", at: [3, 0], label: "kernel done" },
  ],
  routes: [
    { from: "launch", to: "sched" },
    { from: "sched", to: "sm" },
    { from: "sm", to: "done" },
  ],
  claims: [{ metric: "done", min: 640, max: 640, say: "every warp finishes" }],
};

export const figure = {
  fig: "Fig 14",
  caption: ({ sim, variant, fmt }) => {
    const end = (log) => Math.max(...log.filter((r) => r.k === "done").map((r) => r.t));
    let waiting = 0;
    let computing = 0;
    for (const r of sim.log) {
      if (r.k === "wait") waiting += r.t1 - r.t;
      if (r.k === "start" && r.at === "sm/math") computing += r.t1 - r.t;
    }
    const half = variant((m) => (m.parts.find((p) => p.id === "sm").servers = 160));
    const busy = computing / (160 * end(sim.log));
    return `The kernel's 640 warps are done after ${fmt(end(sim.log))}. A warp spends ${Math.round((waiting / (waiting + computing)) * 100)}% of its life waiting for memory, and the work does not stop for it: while one warp waits, the schedulers issue for another (they are busy ${Math.round(busy * 100)}% of the kernel's time, never waiting on a single warp). With room for half as many warps per SM, the same kernel takes ${fmt(end(half.log))}: for a memory-bound kernel, how many warps can wait at once matters more than how fast they compute. Open Resident warps to watch one, and try "Half as many" on it.`;
  },
};
