# Changelog

## 0.1.0

The first release.

- The kit: a process notation with validation (`model.mjs`), durations as people state them (`dist.mjs`), a deterministic discrete-event simulator with one random stream per part and timed changes (`sim.mjs`), a floor plan with a cost-based orthogonal router that gives words the room a wide font needs (`layout.mjs`, `metrics.mjs`), the drawing and its light and dark themes (`render.mjs`), a replay of the simulator's log (`replay.mjs`), the browser runtime (`live.mjs`), page builders with the runtime inlined (`page.mjs`) and the audit (`audit.mjs`).
- The notation: kinds of items with odds and failure rates of their own, switches that turn a station or a choice off, dials whose options change the model from the moment they are chosen, servers that scale with the load (`scale`), and a dot that stands for many items (`per`).
- The page: steps that open into their own processes with a zoom and their own time scale, switches on the plates and settings panels that open on the figure next to their parts (holding across runs), the readout's one number (`watch`), a level bar with the path back and Close, a strip of keys for playback and layers with the readout, items that can be followed with their journey in words, time and failure layers, what-ifs that re-run the model from the moment they are pressed, events and a handle for linking a figure to the rest of a page, words fitted to the reader's own font, keyboard and screen reader support, reduced motion.
- Scripts: `build.mjs` for any model file (`--audit`, `--check`, `--embed`), `check.mjs` (the drawing measured in headless Chrome on every level, both themes, a wide font, desktop and phone), `capture.mjs` and `drive.mjs`, over headless Chrome with Node's built-in modules only.
- Fourteen examples, fifteen figures: a CI pipeline, a request from edge to database, TCP/IP, pub/sub, a serverless checkout, sessions and JWTs with an OAuth login, an LLM and its harness, AES from the mode to the S-box, a memory load from the core to the bits, a CUDA kernel warp by warp, training a neural network, a day of ETL, incident response, and a site under a DDoS attack, whose layers the reader turns off and on.
- Packaging as an Agent Skill, a Claude Code plugin with its own marketplace, and for the skills CLI.
