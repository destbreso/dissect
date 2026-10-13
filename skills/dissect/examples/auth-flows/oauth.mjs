// Logging in with OAuth 2.0: the authorization code flow with PKCE, the way a
// web app should do it today. Three phases, each one a machine you can open:
// the app sends the browser to the authorization server (with a PKCE
// challenge and a state value); the person signs in there; the browser comes
// back with a one-time code, and the app trades code and verifier for tokens on
// a back channel the browser never sees. The lesson is about time: the
// protocol's hops add up to well under a second, and the person is almost all
// of a login. Numbers: round trips of 30 to 80 ms between browser and servers,
// a password typed in about 9 s, 8% mistyped, two people in three with a second
// factor on their phone.

export default {
  id: "oauth-login",
  title: "Logging in with OAuth",
  item: "login",
  about: "The authorization code flow with PKCE. The app never sees the password, the browser never sees the tokens, and the code in the middle is good for one use by the app that asked for it.",
  unit: "s",
  seed: 2,
  horizon: 900,
  lanes: [
    { id: "person", label: "Person" },
    { id: "browser", label: "Browser" },
    { id: "app", label: "App" },
  ],
  parts: [
    { id: "click", kind: "start", lane: "person", at: [0, 0], label: "clicks Log in", every: "exp 20", about: "Three logins a minute, more or less." },
    {
      id: "front",
      kind: "station",
      lane: "browser",
      at: [1, 0],
      label: "Redirect",
      glyph: "browser",
      about: "The app does not ask for a password. It sends the browser to the authorization server with what it wants and a way to prove later that it was the one asking.",
      inside: {
        lanes: [
          { id: "browser", label: "Browser" },
          { id: "app", label: "App" },
          { id: "auth", label: "Auth server" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "browser", at: [0, 0], label: "Log in clicked" },
          { id: "pkce", kind: "station", lane: "app", at: [1, 0], label: "PKCE + state", glyph: "lock", servers: "inf", work: 0.002, about: "A random verifier the app keeps, its SHA-256 hash (the challenge) for the URL, and a random state to tie the answer to this browser." },
          { id: "go", kind: "station", lane: "browser", at: [2, 0], label: "Follow 302", glyph: "browser", servers: "inf", work: 0.01, about: "The browser goes to /authorize with the client id, the redirect URI, the scopes, the state and the challenge." },
          { id: "authorize", kind: "station", lane: "auth", at: [3, 0], label: "GET /authorize", glyph: "key", servers: "inf", work: "logn 0.06 0.2", about: "Checks the client id and that the redirect URI is one registered for it, keeps the challenge, and answers with its own login page." },
          { id: "page", kind: "end", lane: "browser", at: [4, 0], label: "login page" },
        ],
        routes: [
          { from: "in", to: "pkce", latency: "uni 0.015 0.04" },
          { from: "pkce", to: "go", latency: "uni 0.015 0.04" },
          { from: "go", to: "authorize", latency: "uni 0.015 0.04" },
          { from: "authorize", to: "page", latency: "uni 0.015 0.04" },
        ],
      },
    },
    {
      id: "signin",
      kind: "station",
      lane: "person",
      at: [2, 0],
      label: "Sign in",
      glyph: "human",
      about: "On the authorization server's own page: the app never sees the password.",
      inside: {
        lanes: [
          { id: "person", label: "Person" },
          { id: "auth", label: "Auth server" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "person", at: [0, 0], label: "login page" },
          { id: "type", kind: "station", lane: "person", at: [1, 0], label: "Type password", glyph: "human", servers: "inf", work: "logn 9 30", about: "A person, typing: 9 seconds at the median, half a minute for some." },
          { id: "check", kind: "station", lane: "auth", at: [2, 0], label: "Check password", glyph: "lock", servers: 4, work: "logn 0.2 0.5", fail: 0.08, failLabel: "wrong password", about: "bcrypt, slow on purpose so a stolen hash is slow to guess. 8% of tries are wrong." },
          { id: "mfa", kind: "choice", lane: "auth", at: [3, 0], label: "second factor?" },
          { id: "phone", kind: "station", lane: "person", at: [4, 0], label: "Phone approval", glyph: "phone", servers: "inf", work: "logn 7 25", about: "A push notification, found and approved." },
          { id: "done", kind: "end", lane: "auth", at: [5, 0], label: "signed in" },
          { id: "locked", kind: "end", lane: "auth", at: [3, 1], label: "locked out", outcome: "fail" },
        ],
        routes: [
          { from: "in", to: "type" },
          { from: "type", to: "check", latency: "uni 0.015 0.04" },
          { from: "check", to: "mfa", when: "ok", label: "" },
          { id: "again", from: "check", to: "type", when: "fail", max: 2, label: "try again", latency: "uni 0.015 0.04" },
          { id: "lock", from: "check", to: "locked", when: "fail", label: "3rd miss", seldom: true },
          { id: "push", from: "mfa", to: "phone", p: 0.65, label: "yes" },
          { id: "no-mfa", from: "mfa", to: "done", p: 0.35, label: "no" },
          { from: "phone", to: "done", latency: "uni 0.1 0.4" },
        ],
      },
    },
    {
      id: "back",
      kind: "station",
      lane: "app",
      at: [3, 0],
      label: "Code for tokens",
      glyph: "key",
      about: "The browser carries back only a one-time code. The app trades it for tokens directly with the authorization server.",
      inside: {
        lanes: [
          { id: "browser", label: "Browser" },
          { id: "app", label: "App" },
          { id: "auth", label: "Auth server" },
        ],
        parts: [
          { id: "in", kind: "start", lane: "auth", at: [0, 0], label: "signed in" },
          { id: "code", kind: "station", lane: "browser", at: [1, 0], label: "302 with code", glyph: "browser", servers: "inf", work: 0.01, about: "Back to the app's redirect URI with a one-time code (good for about a minute) and the state." },
          { id: "callback", kind: "station", lane: "app", at: [2, 0], label: "GET /callback", glyph: "code", servers: "inf", work: "logn 0.01 0.03", about: "The state must match the one the app stored for this browser; a forged callback stops here." },
          { id: "token", kind: "station", lane: "auth", at: [3, 0], label: "POST /token", glyph: "key", servers: 8, work: "logn 0.04 0.12", about: "Code plus verifier: the server hashes the verifier and compares it with the challenge from the first step. Only the app that started the login can finish it. Out come an access token and a refresh token." },
          { id: "session", kind: "station", lane: "app", at: [4, 0], label: "Start session", glyph: "server", servers: "inf", work: 0.005, about: "The app keeps the tokens on its side and gives the browser a session cookie." },
          { id: "home", kind: "end", lane: "browser", at: [5, 0], label: "logged in" },
        ],
        routes: [
          { from: "in", to: "code", latency: "uni 0.015 0.04" },
          { from: "code", to: "callback", latency: "uni 0.015 0.04" },
          { id: "back-channel", from: "callback", to: "token", label: "back channel", latency: "uni 0.01 0.03" },
          { from: "token", to: "session", latency: "uni 0.01 0.03" },
          { from: "session", to: "home", latency: "uni 0.015 0.04" },
        ],
      },
    },
    { id: "in", kind: "end", lane: "browser", at: [4, 0], label: "logged in" },
    { id: "gave-up", kind: "end", lane: "person", at: [3, 1], label: "locked out", outcome: "fail" },
  ],
  routes: [
    { from: "click", to: "front" },
    { from: "front", to: "signin" },
    { from: "signin", to: "back", when: "ok", label: "" },
    { id: "out", from: "signin", to: "gave-up", when: "fail", label: "", seldom: true },
    { from: "back", to: "in" },
  ],
  claims: [{ metric: "lead.p50", min: 8, max: 40, say: "a login takes some twenty seconds" }],
};

export const figure = {
  fig: "Fig 7",
  caption: ({ run, sim, fmt }) => {
    // the person's time against the protocol's: work at the person's steps vs everything else
    const human = new Set(["signin/type", "signin/phone"]);
    let mine = 0;
    for (const r of sim.log) if (r.k === "start" && human.has(r.at) && r.t1 != null) mine += r.t1 - r.t;
    const total = run.meanLead * run.done;
    const retried = sim.log.filter((r) => r.k === "finish" && r.at === "signin/check" && r.outcome === "fail").length;
    return `A login takes ${fmt(run.p50Lead)} at the median, and ${Math.round((mine / total) * 100)}% of it is the person: typing, retyping (${retried} wrong passwords on this run) and finding the phone. All the protocol's redirects, checks and round trips add up to well under a second. Open Redirect and Code for tokens to see what each hop carries, and why neither the app nor the browser ever holds what it should not.`;
  },
};
