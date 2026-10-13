// Training a neural network, from the perceptron up. One epoch of a small
// image classifier: a data loader with four worker processes prepares batches
// of 64 images on the CPU, and the GPU trains on them one at a time. Open the
// training step: the forward pass runs left to right through the layers (a
// convolution, a pooling layer, a dense layer of 128 neurons, an output layer
// of 10 with the loss, which compares the prediction with the labels), and the backward
// pass runs back right to left, computing every layer's gradient, before the
// optimizer updates the weights. Open a layer for what it does to its inputs:
// the dense layer is 128 perceptrons side by side. The lesson is the classic
// one of real training runs: the GPU waits for data. Double the loader's
// workers and watch the GPU stop waiting. Numbers: a mid-range GPU, images
// read from local disk and augmented in Python.

const conv = {
  parts: [
    { id: "in", kind: "start", at: [0, 0], label: "64 images" },
    { id: "slide", kind: "station", at: [1, 0], label: "Slide filters", glyph: "search", servers: "inf", work: 2.2, about: "32 filters of 3 by 3 pixels by 3 colors slide over every image: each output value is a weighted sum of 27 inputs, the same weights everywhere in the image." },
    { id: "bias", kind: "station", at: [2, 0], label: "Add bias", glyph: "build", servers: "inf", work: 0.2, about: "One number per filter, added everywhere." },
    { id: "relu", kind: "station", at: [3, 0], label: "ReLU", glyph: "gate", servers: "inf", work: 0.6, about: "max(0, x) on every value: the non-linearity that lets layers build on each other." },
    { id: "out", kind: "end", at: [4, 0], label: "32 feature maps" },
  ],
  routes: [
    { from: "in", to: "slide" },
    { from: "slide", to: "bias" },
    { from: "bias", to: "relu" },
    { from: "relu", to: "out" },
  ],
};

const dense = {
  parts: [
    { id: "in", kind: "start", at: [0, 0], label: "inputs" },
    { id: "sum", kind: "station", at: [1, 0], label: "Weighted sum", glyph: "merge", servers: "inf", work: 1.4, about: "Each neuron multiplies every input by its own weight and adds them up: for 128 neurons and the whole batch, one matrix multiply." },
    { id: "bias", kind: "station", at: [2, 0], label: "Add bias", glyph: "build", servers: "inf", work: 0.2, about: "Each neuron adds its own bias: where its threshold sits." },
    { id: "act", kind: "station", at: [3, 0], label: "Activation", glyph: "gate", servers: "inf", work: 0.4, about: "The perceptron (Rosenblatt, 1958) fired when its sum crossed the threshold: a step. Networks now use ReLU or GELU, smooth enough to train by gradients. Without a non-linearity, stacked layers would collapse into a single linear map." },
    { id: "out", kind: "end", at: [4, 0], label: "128 outputs" },
  ],
  routes: [
    { from: "in", to: "sum" },
    { from: "sum", to: "bias" },
    { from: "bias", to: "act" },
    { from: "act", to: "out" },
  ],
};

export default {
  id: "neural-network",
  title: "Training a neural network",
  item: "batch",
  about: "One epoch of an image classifier: the CPU prepares batches, the GPU runs each one forward through the layers, measures the error, runs it backward for the gradients, and updates the weights.",
  unit: "ms",
  seed: 2,
  horizon: 200,
  lanes: [
    { id: "cpu", label: "CPU" },
    { id: "gpu", label: "GPU" },
  ],
  parts: [
    { id: "epoch", kind: "start", lane: "cpu", at: [0, 0], label: "one epoch", every: 1, count: 160, about: "160 batches of 64 images: 10,240 images, each seen once." },
    { id: "loader", kind: "station", lane: "cpu", at: [1, 0], label: "Data loader", glyph: "doc", servers: 4, work: "logn 100 170", about: "Four worker processes read images from disk, decode them, augment them (random crops and flips) and stack 64 into a tensor: about a tenth of a second per batch, each." },
    {
      id: "step",
      kind: "station",
      lane: "gpu",
      at: [2, 0],
      label: "Training step",
      glyph: "robot",
      servers: 1,
      about: "One batch at a time: forward through the layers, the loss, backward for every gradient, then the optimizer's update. The next batch needs the updated weights, so steps cannot overlap.",
      inside: {
        lanes: [
          { id: "fwd", label: "Forward" },
          { id: "bwd", label: "Backward" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "fwd", at: [0, 0], label: "a batch" },
          { id: "conv", kind: "station", lane: "fwd", at: [1, 0], label: "Conv 3×3", glyph: "search", servers: "inf", inside: conv, about: "A convolution layer: 32 small filters that each learn to respond to a local pattern, an edge or a corner." },
          { id: "pool", kind: "station", lane: "fwd", at: [2, 0], label: "Max pool", glyph: "queue", servers: "inf", work: 0.5, about: "Keeps the largest value in every 2 by 2 square: a quarter of the values, and a little indifference to where exactly a pattern is." },
          { id: "dense", kind: "station", lane: "fwd", at: [3, 0], label: "Dense 128", glyph: "team", servers: "inf", inside: dense, about: "128 perceptrons side by side, each looking at every input from the layer before." },
          { id: "head", kind: "station", lane: "fwd", at: [4, 0], label: "Output + loss", glyph: "check", servers: "inf", work: 1, about: "Ten neurons, one per class, give ten scores; softmax turns them into probabilities, and cross-entropy measures how far they are from the true labels." },
          { id: "dhead", kind: "station", lane: "bwd", at: [4, 0], label: "∂ Output", glyph: "check", servers: "inf", work: 1, about: "The gradient of the loss with respect to the output layer's weights, and to its inputs, passed back." },
          { id: "ddense", kind: "station", lane: "bwd", at: [3, 0], label: "∂ Dense 128", glyph: "team", servers: "inf", work: 4, about: "The chain rule again: how much each of the 128 neurons' weights moved the loss. About twice the forward work." },
          { id: "dpool", kind: "station", lane: "bwd", at: [2, 0], label: "∂ Max pool", glyph: "queue", servers: "inf", work: 1, about: "The gradient flows only to the value that was the largest in each square." },
          { id: "dconv", kind: "station", lane: "bwd", at: [1, 0], label: "∂ Conv 3×3", glyph: "search", servers: "inf", work: 6, about: "Gradients for the 32 filters, summed over every position they were used at." },
          { id: "update", kind: "station", lane: "bwd", at: [0, 0], label: "Optimizer", glyph: "wrench", servers: "inf", work: 2.5, uses: ["weights"], about: "Adam: each weight moves a little against its gradient, scaled by running averages of past gradients." },
          { id: "weights", kind: "store", lane: "bwd", at: [1, 1], label: "weights" },
          { id: "done", kind: "end", lane: "bwd", at: [0, 1], label: "updated" },
        ],
        routes: [
          { from: "in", to: "conv" },
          { from: "conv", to: "pool" },
          { from: "pool", to: "dense" },
          { from: "dense", to: "head" },
          { from: "head", to: "dhead", label: "error" },
          { from: "dhead", to: "ddense" },
          { from: "ddense", to: "dpool" },
          { from: "dpool", to: "dconv" },
          { from: "dconv", to: "update" },
          { from: "update", to: "done" },
        ],
      },
    },
    { id: "trained", kind: "end", lane: "gpu", at: [3, 0], label: "weights updated" },
  ],
  routes: [
    { from: "epoch", to: "loader" },
    { from: "loader", to: "step", latency: 0.5 },
    { from: "step", to: "trained" },
  ],
  claims: [{ metric: "step.done", min: 160, max: 160, say: "the whole epoch is trained" }],
};

export const figure = {
  fig: "Fig 12",
  caption: ({ sim, variant, fmt }) => {
    const epochOf = (log) => Math.max(...log.filter((r) => r.k === "done").map((r) => r.t));
    const busyOf = (log) => {
      let busy = 0;
      const open = new Map();
      for (const r of log) {
        if (r.k === "start" && r.at === "step") open.set(r.tok, r.t);
        if (r.k === "finish" && r.at === "step") busy += r.t - open.get(r.tok);
      }
      return busy / epochOf(log);
    };
    const eight = variant((m) => (m.parts.find((p) => p.id === "loader").servers = 8));
    return `The epoch takes ${fmt(epochOf(sim.log))}, and the GPU is busy ${Math.round(busyOf(sim.log) * 100)}% of it: the rest of the time it waits for the next batch, because four loader workers prepare one about every ${fmt(epochOf(sim.log) / 160)} while a training step takes less. With eight workers the GPU is busy ${Math.round(busyOf(eight.log) * 100)}% and the epoch takes ${fmt(epochOf(eight.log))}. Open the training step to watch a batch go forward and back, and a layer to see the perceptrons inside it.`;
  },
};
