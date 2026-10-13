// Who is calling? Two ways a server answers that on every request, side by side.
// A session cookie is a random id: the server looks it up in a session store
// (here a Redis behind a pool of eight connections) to find the user. A JWT
// carries the user inside a signed token: the server only checks the
// signature with its CPU, and needs no store at all, until the token expires
// and the client has to trade its refresh token for a new one at the auth
// server. Requests with neither are sent to log in. The trade-off the figure
// shows: the session store is a dependency every session request has (take
// it down and watch them wait, then fail), while JWT requests do not notice;
// the price of JWTs is that a token stays valid until it expires, even if the
// user logged out (not shown in the run, said in the inspector).
// Numbers: about 200 requests a second, half with sessions, 40% with JWTs.

export default {
  id: "auth-check",
  title: "Session or JWT, on every request",
  item: "request",
  about: "Every request has to say who it is from. A session cookie is looked up in a store; a JWT is checked with a signature and needs no store. Requests with neither are sent to log in.",
  unit: "ms",
  seed: 4,
  horizon: 2000,
  lanes: [
    { id: "edge", label: "Request" },
    { id: "check", label: "Auth check" },
    { id: "store", label: "Stores" },
    { id: "app", label: "App" },
  ],
  parts: [
    { id: "req", kind: "start", lane: "edge", at: [0, 0], label: "request", every: "exp 5", classes: { session: 0.5, JWT: 0.4, anonymous: 0.1 }, about: "About 200 a second: half carry a session cookie, 40% a bearer JWT, 10% nothing." },
    { id: "carries", kind: "choice", lane: "edge", at: [1, 0], label: "carries" },
    { id: "lookup", kind: "station", lane: "store", at: [2, 0], label: "Session lookup", glyph: "cache", servers: 8, work: "logn 0.6 2", patience: 40, uses: ["sessions"], about: "GET session:<id> on Redis through a pool of eight connections. If none frees up within 40 ms, the request fails with a 503: the session store is on the path of every session request." },
    { id: "sessions", kind: "store", lane: "store", at: [2, 1], label: "session store" },
    { id: "verify", kind: "station", lane: "check", at: [2, 0], label: "Verify JWT", glyph: "key", servers: 4, work: "logn 0.12 0.4", about: "Checks the RS256 signature with the auth server's public key and reads the expiry: a fraction of a millisecond of CPU, no network, no store. The flip side: a token stays valid until it expires, even after the user logs out." },
    { id: "fresh", kind: "choice", lane: "check", at: [3, 0], label: "expired?" },
    { id: "refresh", kind: "station", lane: "check", at: [3, 1], label: "Refresh token", glyph: "key", servers: "inf", work: "logn 30 90", about: "The client trades its refresh token for a new access token at the auth server: one network round trip, then it retries." },
    { id: "handle", kind: "station", lane: "app", at: [4, 0], label: "Handle request", glyph: "server", servers: 16, work: "logn 4 15" },
    { id: "ok", kind: "end", lane: "app", at: [5, 0], label: "200" },
    { id: "login", kind: "end", lane: "edge", at: [2, 0], label: "302 to login" },
    { id: "down", kind: "end", lane: "store", at: [3, 0], label: "503" },
  ],
  routes: [
    { from: "req", to: "carries" },
    { id: "by-cookie", from: "carries", to: "lookup", when: "class:session", label: "cookie" },
    { id: "by-token", from: "carries", to: "verify", when: "class:JWT", label: "bearer" },
    { id: "anon", from: "carries", to: "login", when: "class:anonymous", label: "nothing" },
    { from: "lookup", to: "handle", when: "ok", label: "", latency: 0.3 },
    { id: "store-timeout", from: "lookup", to: "down", when: "timeout", label: "no connection", seldom: true },
    { from: "verify", to: "fresh" },
    { id: "valid", from: "fresh", to: "handle", p: 0.95, label: "valid" },
    { id: "expired", from: "fresh", to: "refresh", p: 0.05, label: "expired" },
    { from: "refresh", to: "handle" },
    { from: "handle", to: "ok" },
  ],
  claims: [
    { metric: "lookup.utilization", max: 0.3, say: "the session pool is far from full on an ordinary second" },
  ],
};

export const figure = {
  fig: "Fig 6",
  pace: 2,
  outage: 150,
  caption: ({ run, sim, variant, fmt }) => {
    const by = (log) => {
      const cls = new Map();
      const out = {};
      for (const r of log) {
        if (r.k === "born") cls.set(r.tok, { c: r.cls, t: r.t });
        if (r.k === "done") (out[`${cls.get(r.tok).c}:${r.at}`] ||= []).push(r.t - cls.get(r.tok).t);
      }
      return out;
    };
    const med = (xs) => (xs?.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
    const b = by(sim.log);
    const outage = variant(null, { changes: [{ t: 800, part: "lookup", set: { servers: 0 } }, { t: 950, part: "lookup", set: { servers: 8 } }] });
    const bo = by(outage.log);
    const failed = (bo["session:down"] || []).length;
    const cls = new Map(outage.log.filter((r) => r.k === "born").map((r) => [r.tok, r.cls]));
    const jwtDuring = outage.log.filter((r) => r.k === "done" && r.at === "ok" && r.t > 800 && r.t < 950 && cls.get(r.tok) === "JWT").length;
    return `Checking who sent a request costs a session ${fmt(med(b["session:ok"]))} of request time at the median against ${fmt(med(b["JWT:ok"]))} for a JWT, and the difference is the trip to the session store. Take that store away for ${fmt(150)}: ${failed} session requests wait out their 40 ms and fail with a 503, while ${jwtDuring} requests with JWTs are served in the same ${fmt(150)} as if nothing had happened. That independence is what a JWT buys; what it costs is that a token cannot be taken back before it expires.`;
  },
};
