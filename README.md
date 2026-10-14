<h1 align="center">Dissect</h1>

<p align="center"><b>An Agent Skill that explains a process by running it.</b><br>For Claude Code, and also runs in OpenCode, Codex and Antigravity.<br>Interactive, simulated figures of pipelines, architectures, protocols and human processes, with steps you can open and what-ifs you can try.</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/skills"><img src="https://img.shields.io/badge/Claude_Code-skill-1b1b19?style=flat-square&logo=claude&logoColor=white" alt="Claude Code skill"></a>
  <a href="https://agentskills.io"><img src="https://img.shields.io/badge/Agent_Skills-compatible-1b1b19?style=flat-square" alt="Agent Skills compatible"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1b1b19?style=flat-square" alt="MIT license"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/node-%E2%89%A5%2020.10-1b1b19?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 20.10 or later"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/dependencies-0-1b1b19?style=flat-square" alt="No dependencies"></a>
  <a href="https://github.com/destbreso/dissect/actions/workflows/ci.yml"><img src="https://github.com/destbreso/dissect/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <a href="https://destbreso.com/projects/dissect"><img src="https://img.shields.io/badge/Website-destbreso.com%2Fprojects%2Fdissect-1b1b19?style=for-the-badge" alt="Website: destbreso.com/projects/dissect"></a>
  &nbsp;
  <a href="https://github.com/destbreso/dissect/archive/refs/heads/main.zip"><img src="https://img.shields.io/badge/Download-ZIP-1b1b19?style=for-the-badge&logo=github&logoColor=white" alt="Download ZIP"></a>
  &nbsp;
  <a href="#install"><img src="https://img.shields.io/badge/Install-npx_skills_add-d7d7d0?style=for-the-badge&labelColor=1b1b19&logo=npm&logoColor=white" alt="Install with npx"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#gallery">Gallery</a> ·
  <a href="#install">Install</a> ·
  <a href="#use">Use</a> ·
  <a href="#examples">Examples</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#the-model">The model</a> ·
  <a href="#checks">Checks</a>
</p>

<p align="center">
  <a href="skills/dissect/examples/making-a-figure/making-a-figure.html"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/making-a-figure-dark.png">
    <img src="assets/making-a-figure-light.png" width="900" alt="How Dissect makes a figure: lanes for you, the agent, the kit and headless Chrome. A process to explain goes to Write the model, then Build and Audit in the kit, then Check in Chrome; anything they find goes to Fix it and around again, and Read the pictures ends in your figure. Write the model, Build and Check are steps with a window that opens into their own processes.">
  </picture></a>
</p>

<p align="center"><sub><code>skills/dissect/examples/making-a-figure</code>: the skill's own workflow, made with the skill. Write the model, Build and Check open into their own steps.</sub></p>

---

Describe a process to your agent (a CI/CD pipeline, a request through your architecture, a network protocol, an LLM and its tools, a cipher's rounds, a memory access, an on-call rotation, a site under attack) and Dissect has it build an interactive figure of it: a floor plan of stations, queues, gates and lanes, driven by a seeded discrete-event simulation. A queue on screen is a queue in the model, and every number in the caption is measured from the run the figure plays. Any step that hides a process of its own opens into it, any item can be followed from start to end, and the reader can try what-ifs (an outage, one more reviewer, a colder cache), turn parts off with their switches, open a part's settings on the figure, and watch what happens.

## Quick start

```sh
npx skills add destbreso/dissect -g -a claude-code
```

Then, in Claude Code, in your project's folder:

```text
/dissect the main flow of this project as an interactive figure
```

The agent reads the flow from the code (its steps, queues, workers, timeouts and retries), takes the numbers the code and its config state, and says which ones it assumes. Name the flow you want ("how an upload becomes a thumbnail"), or ask for the fundamental flows and get a figure for each.

As a Claude Code plugin instead: `/plugin marketplace add destbreso/dissect`, then `/plugin install dissect@dissect`, and call it with `/dissect:dissect`. For OpenCode or Codex, swap the agent: `-a opencode` or `-a codex`. OpenCode takes the same `/dissect` command; in Codex, type `$dissect`. You can also just ask: the skill triggers on processes, pipelines, workflows, architectures and protocols.

That's it. No API keys and nothing to `npm install`: the kit uses only Node's built-in modules. The checks need Chrome or Chromium, found where it usually is.

## Gallery

<table>
  <tr>
    <td width="50%"><a href="skills/dissect/examples/ci-pipeline/ci-pipeline.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/ci-pipeline-dark.png"><img src="assets/ci-pipeline-light.png" alt="From commit to production"></picture></a></td>
    <td width="50%"><a href="skills/dissect/examples/ddos/ddos.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/ddos-dark.png"><img src="assets/ddos-light.png" alt="A site under a DDoS attack"></picture></a></td>
  </tr>
  <tr>
    <td><sub><b>From commit to production.</b> CI and Ship open into their own processes; red builds and requested changes go back to the author. A third of a change's time is waiting for the one reviewer on duty.</sub></td>
    <td><sub><b>A site under a DDoS attack.</b> An edge network in front of an origin that scales, under a botnet's flood. Every layer has a switch on it, and a click on the botnet, the crowd or the app servers opens their settings next to them: turn the layers off one by one and watch the pages stop being served.</sub></td>
  </tr>
  <tr>
    <td width="50%"><a href="skills/dissect/examples/tcp-ip/tcp-ip.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tcp-ip-dark.png"><img src="assets/tcp-ip-light.png" alt="One segment through TCP/IP"></picture></a></td>
    <td width="50%"><a href="skills/dissect/examples/llm-harness/llm-harness.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/llm-harness-dark.png"><img src="assets/llm-harness-light.png" alt="A message to an LLM, and its harness"></picture></a></td>
  </tr>
  <tr>
    <td><sub><b>One segment through TCP/IP.</b> Down the sender's layers, through a router whose buffer overflows, up the receiver's. A loss costs a round trip, or a whole retransmission timer.</sub></td>
    <td><sub><b>A message to an LLM, and its harness.</b> The model stays a closed box; the context, the tool loop and the output check are the figure. Every tool call is another full turn through the model.</sub></td>
  </tr>
  <tr>
    <td width="50%"><a href="skills/dissect/examples/aes/aes.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/aes-dark.png"><img src="assets/aes-light.png" alt="AES, from the mode to the S-box"></picture></a></td>
    <td width="50%"><a href="skills/dissect/examples/incident-response/incident-response.html"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/incident-response-dark.png"><img src="assets/incident-response-light.png" alt="An alert, from page to resolved"></picture></a></td>
  </tr>
  <tr>
    <td><sub><b>AES, from the mode to the S-box.</b> CBC and CTR with GCM encrypt the same message side by side; open AES for its rounds, a round for its steps, SubBytes for the S-box.</sub></td>
    <td><sub><b>An alert, from page to resolved.</b> One on-call engineer, escalation after 15 minutes, a war room. Four alerts in five are noise, and real problems wait behind them.</sub></td>
  </tr>
</table>

Six of the fifteen examples; [all of them](#examples) are listed below. Every picture is a page in [`skills/dissect/examples/`](skills/dissect/examples), in the light theme (the dark one on a dark GitHub), captured with [`tools/gallery.mjs`](tools/gallery.mjs). The built pages are committed: open any `.html` there in a browser and it runs, opens and answers what-ifs.

## Install

Dissect is one skill folder, `skills/dissect`, with a `SKILL.md` at its root. Pick one way in:

| | Command | Installs to |
|---|---|---|
| **Claude Code plugin** | `/plugin marketplace add destbreso/dissect`, then `/plugin install dissect@dissect` | managed by Claude Code |
| **skills CLI**, for you | `npx skills add destbreso/dissect -g -a claude-code` | `~/.claude/skills/dissect` |
| **skills CLI**, one project | `npx skills add destbreso/dissect -a claude-code` | `.claude/skills/dissect` |
| **skills CLI**, other agents | `-a codex`, `-a opencode` or `-a antigravity` instead of `-a claude-code` | that agent's skills folder |
| **Download** | see below | any skills folder |

<details>
<summary>Download without git or npm</summary>

```sh
mkdir -p ~/.claude/skills/dissect && curl -L https://github.com/destbreso/dissect/archive/refs/heads/main.tar.gz | tar -xz --strip-components=3 -C ~/.claude/skills/dissect dissect-main/skills/dissect
```

For a project, use `.claude/skills/dissect` instead. For Codex use `~/.agents/skills/dissect`, for OpenCode `~/.config/opencode/skills/dissect`, for Antigravity `~/.gemini/antigravity/skills/dissect`.

</details>

There is nothing else to install: the kit uses only Node's built-in modules. The browser checks need Chrome or Chromium.

## Use

Ask for what you want to explain. The skill triggers on processes, pipelines, workflows, architectures, flows and protocols, whether or not you say "diagram" or "simulation":

> Map the fundamental flows of this repository as interactive figures, with the numbers from its code and config.

> Our PRs take forever to merge and everyone blames CI. Make an interactive figure of our pipeline for the wiki: about 30 PRs a day, CI takes 8 minutes, two of us review, and one PR in five gets changes requested.

> Explain how TCP retransmission works with something visual and interactive.

> Show how memory works, from flip-flops up to the cache hierarchy and RAM, for a computer architecture class.

> How does a site survive a DDoS attack? I want to turn the WAF, the rate limit and the cache off one at a time and see what breaks.

The agent writes a model of the process with your numbers, the ones the code states, or assumptions it names, calibrates it on several runs, writes the caption from the run, builds a standalone HTML page (or a fragment for a page you have, or a React component), audits it, and checks it in a headless browser. With `/dissect` (or `/dissect:dissect` from the plugin) you can call it by name.

## Examples

Every example is a model, `model.mjs`, and the page built from it next to it. Rebuild one with its build script; add `--light` or `--dark` for one theme, `--audit` for the audit.

| Example | What it shows | Build |
|---|---|---|
| [`making-a-figure`](skills/dissect/examples/making-a-figure/making-a-figure.html) | **How Dissect makes a figure.** The skill's own workflow, as a figure: the agent writes the model, the kit builds and audits it in about a second, headless Chrome checks it in under a minute, and anything they find goes back to the agent. Open Build and Check for their steps. | `node skills/dissect/examples/making-a-figure/build.mjs` |
| [`ci-pipeline`](skills/dissect/examples/ci-pipeline/ci-pipeline.html) | **From commit to production.** CI and Ship open into their own processes; red builds and requested changes go back to the author. A third of a change's time is waiting for the one reviewer on duty. | `node skills/dissect/examples/ci-pipeline/build.mjs` |
| [`request-path`](skills/dissect/examples/request-path/request-path.html) | **One request, edge to database.** Requests travel with real latencies. The trip is almost all of the time, and a colder cache fills the API's workers until 504s start. | `node skills/dissect/examples/request-path/build.mjs` |
| [`tcp-ip`](skills/dissect/examples/tcp-ip/tcp-ip.html) | **One segment through TCP/IP.** Down the sender's layers, through a router whose buffer overflows, up the receiver's. A loss costs a round trip, or a whole retransmission timer. | `node skills/dissect/examples/tcp-ip/build.mjs` |
| [`pubsub`](skills/dissect/examples/pubsub/pubsub.html) | **One event, three subscribers.** A fan-out to email, inventory and analytics, each with its own queue, retries and dead letters. Take one down and the others do not notice. | `node skills/dissect/examples/pubsub/build.mjs` |
| [`serverless`](skills/dissect/examples/serverless/serverless.html) | **A checkout on serverless.** Concurrency limits and cold starts on the synchronous path, a queue on the asynchronous one. A burst is refused by one and absorbed by the other. | `node skills/dissect/examples/serverless/build.mjs` |
| [`auth-flows`](skills/dissect/examples/auth-flows/auth-flows.html) | **Sessions, JWTs and OAuth.** The check on every request, with a session store outage as the what-if, and an OAuth login with PKCE in three phases you can open. | `node skills/dissect/examples/auth-flows/build.mjs` |
| [`llm-harness`](skills/dissect/examples/llm-harness/llm-harness.html) | **A message to an LLM, and its harness.** The model stays a closed box; the context, the tool loop and the output check are the figure. Every tool call is another full turn through the model. | `node skills/dissect/examples/llm-harness/build.mjs` |
| [`aes`](skills/dissect/examples/aes/aes.html) | **AES, from the mode to the S-box.** CBC and CTR with GCM encrypt the same message side by side; open AES for its rounds, a round for its steps, SubBytes for the S-box. | `node skills/dissect/examples/aes/build.mjs` |
| [`memory`](skills/dissect/examples/memory/memory.html) | **A load, from the core to the bits.** Five levels deep: L1 down to its SRAM array and output flip-flop, the miss path down to DRAM's row activation, where a bit is a capacitor. | `node skills/dissect/examples/memory/build.mjs` |
| [`cuda`](skills/dissect/examples/cuda/cuda.html) | **A CUDA kernel, warp by warp.** 640 warps alternate between waiting for memory and computing. Halve the warps that can wait at once and the kernel takes twice as long. | `node skills/dissect/examples/cuda/build.mjs` |
| [`neural-network`](skills/dissect/examples/neural-network/neural-network.html) | **Training a neural network.** A data loader feeds the GPU; the forward pass runs one way and the backward pass the other; a layer is 128 perceptrons. The GPU waits for data. | `node skills/dissect/examples/neural-network/build.mjs` |
| [`etl`](skills/dissect/examples/etl/etl.html) | **A day of ETL, source to dashboard.** Three sources at their own rhythm, through extract, land, transform, load and checks. One step, the join, is most of the time to the dashboard. | `node skills/dissect/examples/etl/build.mjs` |
| [`incident-response`](skills/dissect/examples/incident-response/incident-response.html) | **An alert, from page to resolved.** One on-call engineer, escalation after 15 minutes, a war room. Four alerts in five are noise, and real problems wait behind them. | `node skills/dissect/examples/incident-response/build.mjs` |
| [`ddos`](skills/dissect/examples/ddos/ddos.html) | **A site under a DDoS attack.** An edge network in front of an origin that scales, under a botnet's flood. Every layer has a switch on it, and a click on the botnet, the crowd or the app servers opens their settings next to them: turn the layers off one by one and watch the pages stop being served. | `node skills/dissect/examples/ddos/build.mjs` |

## How it works

1. **A model.** One JavaScript object: lanes, parts (starts, stations with servers and work times, choices, parallel splits and joins, timers, stores, ends), routes with odds or outcomes and latencies, kinds of items with odds of their own, switches and dials for the reader, servers that scale, and the claims the prose makes about the numbers. Durations are written the way people know them: `"logn 12 30"` is a median of 12 and a p95 of 30.
2. **A simulation.** A discrete-event simulator runs the model with one seed and one random stream per part, so a run is reproducible and a what-if changes only what comes after it. It was checked against queueing theory (M/M/1 and Little's law).
3. **A floor plan.** Columns sized to their parts, a router that picks every orthogonal route by cost (never through a part or over words), and a drawing in which each detail stands for a quantity: one bay per server, one tick per place in the queue, a gauge for the busy share, a needle for the last decision.
4. **A page.** A standalone HTML file with the runtime inlined (no network, no build step): the page replays the simulator's log, so the drawing moves only as the model does. Levels open with a zoom, the clock slows to each level's own scale, items can be followed, and the what-ifs re-run the model from the moment you press them.
5. **Checks.** An audit of the model, the floor plan, the run and the claims on eight seeds; a visual check that measures the drawing in headless Chrome on every level, in both themes and in a wide font, on a desktop and a phone (words inside their plates and clear of rails, contrast, sideways scroll, a short drive); captures and scripted drives.

`skills/dissect/SKILL.md` is the workflow the agent follows; `skills/dissect/references/` has the notation, the craft, the kit's API, the page's behavior, the checks and a walkthrough.

## The model

```js
export default {
  id: "review-loop", title: "A change through review", item: "change", unit: "min", seed: 1, horizon: 480,
  lanes: [{ id: "dev", label: "Author" }, { id: "review", label: "Review" }],
  parts: [
    { id: "push", kind: "start", lane: "dev", at: [0, 0], every: "exp 20" },
    { id: "review", kind: "station", lane: "review", at: [1, 0], label: "Code review", servers: 1, work: "logn 12 30", fail: 0.15, failLabel: "changes requested" },
    { id: "fix", kind: "station", lane: "dev", at: [1, 0], label: "Fix it", servers: "inf", work: "logn 15 45" },
    { id: "merged", kind: "end", lane: "review", at: [2, 0] },
  ],
  routes: [
    { from: "push", to: "review" },
    { from: "review", to: "merged", when: "ok", label: "approved" },
    { from: "review", to: "fix", when: "fail", label: "changes" },
    { from: "fix", to: "review" },
  ],
  claims: [{ metric: "review.waitShare", min: 0.2, say: "much of a change's time is waiting for review" }],
};
```

```sh
node skills/dissect/scripts/build.mjs review-loop.mjs --audit    # writes review-loop.html next to it
```

## Checks

```sh
npm test                                                               # the kit and every example's audit
node skills/dissect/examples/ci-pipeline/build.mjs --audit --check     # ends with "audit passed" and "check passed"
node skills/dissect/scripts/capture.mjs page.html --width 390 --out phone.png
node skills/dissect/scripts/drive.mjs page.html --actions steps.json   # clicks, keys, what-ifs, asserts
```

## Requirements

| | For | Notes |
|---|---|---|
| Node.js 20.10+ | builds, kit, checks | Built-in modules only. On Node 20 the browser scripts restart themselves with `--experimental-websocket`. |
| Chrome or Chromium | the browser checks | Found in the usual places on macOS, Linux and Windows and in Playwright's cache; set `CHROME_PATH` for any other. |
| React 18+ | React output only | See `skills/dissect/references/kit.md`. |

## Credits

Dissect takes its idea from [Anatomy](https://github.com/wheresryan22/anatomy), which explains a technical idea as a crafted isometric machine whose working is the concept. Dissect applies that to processes: the machine is the process itself, and it runs.

## License

[MIT](LICENSE) © 2026 David Estévez
