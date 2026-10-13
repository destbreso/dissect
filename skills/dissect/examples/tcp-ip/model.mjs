// TCP/IP: what one segment goes through between two programs. On the way out
// it goes down the sender's stack (TCP adds ports and a sequence number, IP
// adds addresses and picks the next hop, the link puts a frame on the wire),
// crosses the home router, whose 10 Mbit/s uplink is the narrowest part of the
// path, then the internet, and climbs the receiver's stack, which answers with
// an ACK. The router's buffer holds eight packets; when it is full, the next
// one is dropped. TCP notices one of two ways: three duplicate ACKs from the
// packets behind it (a resend after about one round trip), or, when it was
// the last of its burst, nothing at all until the retransmission timer fires
// (200 ms, Linux's minimum). The sender here keeps its pace after a loss; a
// real one would also slow down (congestion control), which this figure
// leaves out. Numbers: 1,500-byte packets, about 85% of the uplink in use, a
// 22 ms round trip across the internet.

export default {
  id: "tcp-ip",
  title: "One segment through TCP/IP",
  item: "segment",
  about: "A segment goes down the sender's stack, through the home router and across the internet, up the receiver's stack, and an ACK comes back. When the router's buffer is full the segment is dropped, and TCP sends it again.",
  unit: "ms",
  seed: 2,
  horizon: 1600,
  lanes: [
    { id: "sender", label: "Sender" },
    { id: "net", label: "Network" },
    { id: "receiver", label: "Receiver" },
  ],
  parts: [
    { id: "app", kind: "start", lane: "sender", at: [0, 0], label: "app writes", every: "exp 1.4", about: "The program writes; TCP cuts the bytes into segments of up to 1,460 bytes each." },
    {
      id: "send",
      kind: "station",
      lane: "sender",
      at: [1, 0],
      label: "Sender's stack",
      glyph: "server",
      servers: "inf",
      about: "Down the layers: each one wraps the segment in its own header.",
      inside: {
        lanes: [
          { id: "transport", label: "Transport" },
          { id: "internet", label: "Internet" },
          { id: "link", label: "Link" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "transport", at: [0, 0], label: "bytes" },
          { id: "tcp", kind: "station", lane: "transport", at: [1, 0], label: "TCP header", glyph: "doc", servers: "inf", work: 0.02, about: "Source and destination ports, the sequence number of the first byte, the window, a checksum." },
          { id: "ip", kind: "station", lane: "internet", at: [2, 0], label: "IP header", glyph: "network", servers: "inf", work: 0.01, about: "Source and destination addresses and a time to live; the routing table picks the next hop." },
          { id: "nic", kind: "station", lane: "link", at: [3, 0], label: "Ethernet out", glyph: "server", servers: 1, work: 0.12, about: "The network card sends the frame: 1,500 bytes at 100 Mbit/s take 0.12 ms." },
          { id: "wire", kind: "end", lane: "link", at: [4, 0], label: "on the wire" },
        ],
        routes: [
          { from: "in", to: "tcp" },
          { from: "tcp", to: "ip" },
          { from: "ip", to: "nic" },
          { from: "nic", to: "wire" },
        ],
      },
    },
    { id: "router", kind: "station", lane: "net", at: [2, 0], label: "Home router", glyph: "balance", servers: 1, work: 1.2, capacity: 8, about: "Its 10 Mbit/s uplink sends one 1,500-byte packet every 1.2 ms. Eight more can wait in its buffer; the next is dropped." },
    {
      id: "recv",
      kind: "station",
      lane: "receiver",
      at: [3, 0],
      label: "Receiver's stack",
      glyph: "server",
      servers: "inf",
      about: "Up the layers: each one checks and removes its header; TCP puts the bytes in order and acknowledges them.",
      inside: {
        lanes: [
          { id: "transport", label: "Transport" },
          { id: "internet", label: "Internet" },
          { id: "link", label: "Link" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "link", at: [0, 0], label: "off the wire" },
          { id: "nic", kind: "station", lane: "link", at: [1, 0], label: "Ethernet in", glyph: "server", servers: 1, work: 0.12, about: "The card checks the frame's CRC and hands the packet up." },
          { id: "ip", kind: "station", lane: "internet", at: [2, 0], label: "IP: for me?", glyph: "network", servers: "inf", work: 0.01, about: "The destination address is this host's: the header comes off." },
          { id: "tcp", kind: "station", lane: "transport", at: [3, 0], label: "TCP: in order", glyph: "doc", servers: "inf", work: 0.03, about: "Checks the checksum, puts the bytes in sequence and hands them to the program." },
          { id: "ack", kind: "station", lane: "transport", at: [4, 0], label: "Send ACK", glyph: "check", servers: "inf", work: 0.02, about: "Acknowledges every byte received in order so far." },
          { id: "out", kind: "end", lane: "transport", at: [5, 0], label: "ACK sent" },
        ],
        routes: [
          { from: "in", to: "nic" },
          { from: "nic", to: "ip" },
          { from: "ip", to: "tcp" },
          { from: "tcp", to: "ack" },
          { from: "ack", to: "out" },
        ],
      },
    },
    { id: "acked", kind: "end", lane: "sender", at: [4, 0], label: "acknowledged" },
    { id: "noticed", kind: "choice", lane: "net", at: [3, 1], label: "how TCP finds out" },
    { id: "dup", kind: "timer", lane: "sender", at: [2, 1], label: "3 duplicate ACKs", wait: "uni 20 26", about: "The packets behind it arrive, and each makes the receiver repeat its last ACK. On the third repeat the sender resends: about one round trip." },
    { id: "rto", kind: "timer", lane: "sender", at: [3, 1], label: "timer expires", wait: 200, about: "Nothing came behind it, so no duplicate ACKs: the sender waits for its retransmission timer, 200 ms at least." },
  ],
  routes: [
    { from: "app", to: "send" },
    { from: "send", to: "router", latency: 0.3 },
    { id: "forward", from: "router", to: "recv", when: "ok", label: "", latency: "uni 10 12" },
    { id: "dropped", from: "router", to: "noticed", when: "rejected", label: "dropped" },
    { id: "fast", from: "noticed", to: "dup", p: 0.85, label: "more behind it" },
    { id: "tail", from: "noticed", to: "rto", p: 0.15, label: "it was the last" },
    { id: "resend", from: "dup", to: "send" },
    { id: "resend-late", from: "rto", to: "send" },
    { id: "ack", from: "recv", to: "acked", label: "ACK", latency: "uni 10 12" },
  ],
  claims: [
    { metric: "lead.p50", min: 20, max: 40, say: "a segment is acknowledged in about one round trip" },
    { metric: "router.utilization", min: 0.7, max: 0.95, say: "the uplink is busy most of the time" },
  ],
};

export const figure = {
  fig: "Fig 3",
  pace: 5,
  caption: ({ run, sim, fmt }) => {
    const drops = sim.log.filter((r) => r.k === "reject").length;
    // the segments that waited for the retransmission timer, and how long they took in all
    const timed = new Set(sim.log.filter((r) => r.k === "wait" && r.at === "rto").map((r) => r.tok));
    const born = new Map(sim.log.filter((r) => r.k === "born").map((r) => [r.tok, r.t]));
    const leads = sim.log.filter((r) => r.k === "done" && timed.has(r.tok)).map((r) => r.t - born.get(r.tok)).sort((a, b) => a - b);
    const typical = leads.length ? leads[Math.floor(leads.length / 2)] : null;
    return `All ${run.born} segments sent in ${fmt(1600)} arrive and are acknowledged, ${fmt(run.p50Lead)} at the median: one round trip plus the wait in the router's buffer. The buffer overflowed ${drops} times (${((drops / run.born) * 100).toFixed(1)}% of segments), and TCP pays for every loss in time, not data: about one more round trip when duplicate ACKs give it away${typical != null ? `, and ${fmt(typical)} in all for the ${leads.length} segments that had to wait for the retransmission timer` : ""}. Try a burst on "app writes", or open either stack to watch the layers.`;
  },
};
