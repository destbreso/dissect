// AES, from the mode of operation down to the S-box, in CPU cycles. The same
// 1 KB message (64 blocks of 16 bytes) is encrypted twice, side by side:
// with CBC, where each block is XORed with the previous ciphertext before it
// is encrypted, so one AES core does every block in a line; and with CTR,
// where AES encrypts counters that are all known in advance, eight at a time,
// and GCM folds each ciphertext block into a running hash (GHASH) for
// integrity. Every AES is a machine you can open: 10 rounds; each round
// SubBytes, ShiftRows, MixColumns and AddRoundKey; SubBytes is the S-box, an
// inverse in GF(2^8) and an affine map. AES is a substitution-permutation
// network, not a Feistel cipher: every round transforms all 16 bytes. The
// cycle counts are those of AES-NI on a recent x86 core (a round in about
// 3 to 4 cycles, eight blocks in flight when nothing ties them together).

const SBOX = {
  parts: [
    { id: "in", kind: "start", at: [0, 0], label: "a byte" },
    { id: "inverse", kind: "station", at: [1, 0], label: "GF(2⁸) inverse", glyph: "key", servers: "inf", work: 1, about: "The byte becomes its multiplicative inverse in the field of 256 elements (0 stays 0). This is where AES stops being linear: no equation of low degree ties output to input." },
    { id: "affine", kind: "station", at: [2, 0], label: "Affine map", glyph: "build", servers: "inf", work: 0.5, about: "A fixed bit matrix, then XOR with 0x63, so that no byte maps to itself or to its complement. The whole S-box is a 256-entry table; hardware computes it this way." },
    { id: "out", kind: "end", at: [3, 0], label: "substituted" },
  ],
  routes: [
    { from: "in", to: "inverse" },
    { from: "inverse", to: "affine" },
    { from: "affine", to: "out" },
  ],
};

const round = (mix) => ({
  parts: [
    { id: "in", kind: "start", at: [0, 0], label: "the state" },
    { id: "sub", kind: "station", at: [1, 0], label: "SubBytes", glyph: "key", servers: "inf", inside: SBOX, about: "All 16 bytes of the 4 by 4 state go through the S-box at once." },
    { id: "shift", kind: "station", at: [2, 0], label: "ShiftRows", glyph: "queue", servers: "inf", work: 0.25, about: "Row r of the state rotates left by r bytes, so each column now holds bytes from four different columns. In hardware it is only wiring." },
    ...(mix ? [{ id: "mix", kind: "station", at: [3, 0], label: "MixColumns", glyph: "merge", servers: "inf", work: 1, about: "Each column is multiplied by a fixed matrix over GF(2^8): every output byte depends on all four input bytes. With ShiftRows, one changed byte reaches all 16 within two rounds." }] : []),
    { id: "ark", kind: "station", at: [mix ? 4 : 3, 0], label: "AddRoundKey", glyph: "lock", servers: "inf", work: 0.5, about: "XOR with this round's 16-byte key, expanded from the cipher key by the key schedule." },
    { id: "out", kind: "end", at: [mix ? 5 : 4, 0], label: "next state" },
  ],
  routes: [
    { from: "in", to: "sub" },
    { from: "sub", to: "shift" },
    ...(mix ? [{ from: "shift", to: "mix" }, { from: "mix", to: "ark" }] : [{ from: "shift", to: "ark" }]),
    { from: "ark", to: "out" },
  ],
});

const AES = {
  parts: [
    { id: "in", kind: "start", at: [0, 0], label: "16 bytes" },
    { id: "whiten", kind: "station", at: [1, 0], label: "AddRoundKey", glyph: "lock", servers: "inf", work: 0.5, uses: ["keys"], about: "Before any round, the block is XORed with the first round key: the key is in from the start." },
    { id: "round", kind: "station", at: [2, 0], label: "Round", glyph: "build", servers: "inf", inside: round(true), about: "SubBytes, ShiftRows, MixColumns, AddRoundKey. AES-128 runs nine of these and a tenth without MixColumns." },
    { id: "more", kind: "choice", at: [3, 0], label: "rounds left?" },
    { id: "final", kind: "station", at: [4, 0], label: "Final round", glyph: "build", servers: "inf", inside: round(false), about: "The tenth round leaves out MixColumns, which makes decryption the same shape as encryption." },
    { id: "keys", kind: "store", at: [1, 1], label: "round keys" },
    { id: "out", kind: "end", at: [5, 0], label: "16 bytes" },
  ],
  routes: [
    { from: "in", to: "whiten" },
    { from: "whiten", to: "round" },
    { from: "round", to: "more" },
    { id: "again", from: "more", to: "round", when: "ok", max: 8, label: "9 rounds" },
    { id: "last", from: "more", to: "final", when: "ok", label: "" },
    { from: "final", to: "out" },
  ],
};

const aesAbout = "AES-128: a substitution-permutation network of 10 rounds. Unlike a Feistel cipher such as DES, where each round transforms half the block and swaps the halves, every AES round transforms all 16 bytes.";

export default {
  id: "aes",
  title: "AES, from the mode to the S-box",
  item: "block",
  about: "One message, two modes of operation. CBC chains every block to the one before it; CTR encrypts counters that do not depend on the data, so its blocks can be encrypted side by side.",
  unit: "cycles",
  seed: 1,
  horizon: 100,
  lanes: [
    { id: "cbc", label: "CBC" },
    { id: "ctr", label: "CTR + GCM" },
  ],
  parts: [
    { id: "msg1", kind: "start", lane: "cbc", at: [0, 0], label: "1 KB message", every: 1, count: 64, about: "64 blocks of 16 bytes, ready at once." },
    {
      id: "cbc",
      kind: "station",
      lane: "cbc",
      at: [1, 0],
      label: "CBC encrypt",
      glyph: "lock",
      servers: 1,
      about: "Each block is XORed with the previous ciphertext, then encrypted: a block cannot start before the one ahead of it is done. (Decryption has no such chain and runs in parallel.)",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "plaintext" },
          { id: "xor", kind: "station", at: [1, 0], label: "XOR last block", glyph: "merge", servers: "inf", work: 0.5, about: "XOR with the previous block's ciphertext (with a random IV for the first), so equal plaintext blocks encrypt differently." },
          { id: "aes", kind: "station", at: [2, 0], label: "AES-128", glyph: "lock", servers: "inf", inside: AES, about: aesAbout },
          { id: "out", kind: "end", at: [3, 0], label: "ciphertext" },
        ],
        routes: [
          { from: "in", to: "xor" },
          { from: "xor", to: "aes" },
          { from: "aes", to: "out" },
        ],
      },
    },
    { id: "out1", kind: "end", lane: "cbc", at: [3, 0], label: "ciphertext" },
    { id: "msg2", kind: "start", lane: "ctr", at: [0, 0], label: "1 KB message", every: 1, count: 64, about: "The same 64 blocks." },
    {
      id: "ctr",
      kind: "station",
      lane: "ctr",
      at: [1, 0],
      label: "CTR encrypt",
      glyph: "lock",
      servers: 8,
      about: "AES encrypts a counter (nonce and block number), and the result is XORed with the plaintext. The counters are known in advance, so eight blocks are in the AES pipeline at once.",
      inside: {
        parts: [
          { id: "in", kind: "start", at: [0, 0], label: "block number" },
          { id: "count", kind: "station", at: [1, 0], label: "Counter", glyph: "queue", servers: "inf", work: 0.25, about: "Nonce and block number: 16 bytes that never repeat under the same key." },
          { id: "aes", kind: "station", at: [2, 0], label: "AES-128", glyph: "lock", servers: "inf", inside: AES, about: aesAbout },
          { id: "xor", kind: "station", at: [3, 0], label: "XOR plaintext", glyph: "merge", servers: "inf", work: 0.5, about: "The encrypted counter is a key stream; XOR with the plaintext gives the ciphertext." },
          { id: "out", kind: "end", at: [4, 0], label: "ciphertext" },
        ],
        routes: [
          { from: "in", to: "count" },
          { from: "count", to: "aes" },
          { from: "aes", to: "xor" },
          { from: "xor", to: "out" },
        ],
      },
    },
    { id: "ghash", kind: "station", lane: "ctr", at: [2, 0], label: "GHASH", glyph: "check", servers: 1, work: 1.5, about: "GCM's integrity: each ciphertext block is folded into a running hash with a multiplication in GF(2^128). It is a chain too, but a short one (a carry-less multiply per block)." },
    { id: "out2", kind: "end", lane: "ctr", at: [3, 0], label: "ciphertext + tag" },
  ],
  routes: [
    { from: "msg1", to: "cbc" },
    { from: "cbc", to: "out1" },
    { from: "msg2", to: "ctr" },
    { from: "ctr", to: "ghash" },
    { from: "ghash", to: "out2" },
  ],
  claims: [{ metric: "cbc.done", min: 64, max: 64, say: "all 64 blocks are encrypted in CBC" }],
};

export const figure = {
  fig: "Fig 10",
  caption: ({ sim, fmt }) => {
    const last = (end) => Math.max(...sim.log.filter((r) => r.k === "done" && r.at === end).map((r) => r.t));
    const cbc = last("out1");
    const ctr = last("out2");
    return `The same 1 KB message, 64 blocks: CBC has the last block encrypted after ${fmt(cbc)}, CTR with GCM after ${fmt(ctr)}, ${(cbc / ctr).toFixed(1)} times sooner. In CBC each block waits for the ciphertext of the one before it, so a single AES does them in a line; in CTR the counters are known in advance and eight blocks share the AES pipeline, and GHASH adds a short chain of its own for integrity. Open either AES for the 10 rounds, a round for its four steps, and SubBytes for the S-box.`;
  },
};
