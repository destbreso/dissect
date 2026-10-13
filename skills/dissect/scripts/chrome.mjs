// Headless Chrome over the DevTools protocol, with nothing but Node's own
// modules (Node 22 has a global WebSocket; older Node is re-run with the flag).
// capture.mjs and drive.mjs are thin commands on top of this session.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Re-run this script with --experimental-websocket when the Node has no WebSocket. Returns true if it did. */
export function needsWebSocketFlag() {
  if (typeof WebSocket !== "undefined" || process.execArgv.includes("--experimental-websocket")) return false;
  const child = spawn(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
  return true;
}

export function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const root of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      for (const sub of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
      ])
        found.push(join(root, dir, sub));
    }
  }
  return found.find((p) => existsSync(p));
}

function portOf(chrome) {
  return new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not start within 20 s")), 20000);
    chrome.stderr.on("data", (chunk) => {
      text += chunk;
      const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        done(Number(m[1]));
      }
    });
    chrome.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    chrome.on("exit", (code, signal) => {
      clearTimeout(timer);
      fail(new Error(`Chrome exited before it started: ${code ?? signal}`));
    });
  });
}

export const urlOf = (target) => (/^(https?|file):/.test(target) ? target : pathToFileURL(resolve(target)).href);
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Open a page in headless Chrome. Returns a session:
 *   send(method, params), evaluate(js), shot(path, clip?, scale?), boxOf(selector),
 *   click(x, y), key(key), problems (console errors and exceptions), close()
 */
export async function open(target, { width = 1280, height = 900, scale = 2, reduced = false, theme = null, wait = 1200 } = {}) {
  const binary = chromePath();
  if (!binary) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
  const profile = mkdtempSync(join(tmpdir(), "dissect-chrome-"));
  const chrome = spawn(binary, [
    "--headless=new",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "about:blank",
  ]);
  const cleanup = () => {
    chrome.kill("SIGKILL");
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  let port;
  try {
    port = await portOf(chrome);
  } catch (e) {
    cleanup();
    throw e;
  }
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  let loaded = () => {};
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.method === "Page.loadEventFired") loaded();
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) {
      problems.push(`console.${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 500)}`);
    } else if (data.method === "Runtime.exceptionThrown") {
      const d = data.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`.slice(0, 800));
    }
  };
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error("could not talk to Chrome"));
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const call = ++id;
      const timer = setTimeout(() => {
        pending.delete(call);
        fail(new Error(`Chrome did not answer ${method} within 60 s`));
      }, 60000);
      pending.set(call, (data) => {
        clearTimeout(timer);
        if (data.error) fail(new Error(`${method}: ${data.error.message}`));
        else done(data.result);
      });
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const features = [];
  if (reduced) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  if (theme) features.push({ name: "prefers-color-scheme", value: theme });
  if (features.length) await send("Emulation.setEmulatedMedia", { features });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < 600 });
  const load = new Promise((done) => {
    loaded = done;
    setTimeout(done, 15000);
  });
  const nav = await send("Page.navigate", { url: urlOf(target) });
  if (nav.errorText) throw new Error(`could not open ${target}: ${nav.errorText}`);
  await load;
  await sleep(wait);

  const session = {
    send,
    evaluate,
    problems,
    async boxOf(selector) {
      const box = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height,vx:r.left,vy:r.top}})()`);
      if (!box) throw new Error(`nothing matches ${selector}`);
      return box;
    },
    async scrollTo(selector) {
      await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el)el.scrollIntoView({block:"center"})})()`);
      await sleep(80);
    },
    /** Screenshot a page region (CSS px, page coordinates) at a pixel ratio relative to the device scale. */
    async shot(path, clip, ratio = 1) {
      const params = { format: "png", captureBeyondViewport: true };
      if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: ratio };
      const r = await send("Page.captureScreenshot", params);
      mkdirSync(dirname(resolve(path)), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
    async click(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
    },
    async move(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    },
    async key(key) {
      const named = { " ": ["Space", 32], Enter: ["Enter", 13], Escape: ["Escape", 27], Tab: ["Tab", 9], ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40] };
      const [code, vk] = named[key] ?? [/^[0-9]$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key, key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0];
      const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text, windowsVirtualKeyCode: vk });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    },
    async close() {
      try {
        socket.close();
      } catch {}
      cleanup();
    },
  };
  return session;
}
