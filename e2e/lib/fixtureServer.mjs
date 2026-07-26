/**
 * Disposable local HTTP fixture server for browser E2E (ADR-BR3).
 *
 * Purpose: give browser journeys destinations we CONTROL, on 127.0.0.1, with no
 * public network. Three reasons that matters:
 *   1. Determinism — a real site changes under us; an ARIA snapshot of one is a
 *      flake generator.
 *   2. Offline — the suite must run on a plane.
 *   3. SSRF assertions need targets that are *supposed* to be refused (redirects
 *      into private space, alternate IPv4 spellings). You cannot get those from a
 *      public host, and you must not point a security test at someone else's
 *      infrastructure.
 *
 * ORACLES, NOT JUST PAGES. This is the part that decides whether the journeys
 * built on it can fail. Serving HTML proves nothing on its own: `act` returning
 * `clicked: true` only means `HTMLElement.click()` returned, and a URL that fails
 * to load looks exactly like one refused by policy. So every endpoint records a
 * server-side hit counter, and interactive fixtures record what the page actually
 * DID. A journey asserts the counter, not the action's own say-so.
 *
 * @coordinates-with e2e/lib/browser.mjs — the journeys that consume these fixtures
 */

import { createServer } from "node:http";

/** Pages keyed by path. Static, no timers, no web fonts — see ADR-BR3. */
const PAGES = {
  /** Plain landing page with a stable accessible name to read/act on. */
  "/": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — home</title></head><body>
<h1>Fixture Home</h1>
<p id="marker">home-loaded</p>
<button id="act-target" onclick="fetch('/hit/clicked').then(()=>{document.getElementById('marker').textContent='button-clicked';})">Press Me</button>
<a id="to-second" href="/second">Go to second</a>
<input id="field" aria-label="Search field" type="text">
</body></html>`,

  /** A full-bleed SOLID colour, for the occlusion pixel oracle (B14).
   *
   *  Magenta because nothing in VMark's chrome or any theme is near it: if this
   *  colour is on screen, the native webview is painting; if it is not, it is
   *  hidden. A page that shared a colour with the app UI could not distinguish
   *  those two states. */
  "/solid": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — solid</title>
<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#ff00ff}</style>
</head><body><div id="marker" style="display:none">solid-loaded</div></body></html>`,

  /** Second page — history depth for back/forward. */
  "/second": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — second</title></head><body>
<h1>Second Page</h1><p id="marker">second-loaded</p>
<a id="to-home" href="/">Back home</a>
</body></html>`,

  /** Distinct marker for the redirect DESTINATION, so a journey can prove the
   *  committed URL is the final one and not the requested one. */
  "/redirected": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — redirected</title></head><body>
<h1>Redirect Destination</h1><p id="marker">redirect-destination-loaded</p>
</body></html>`,

  /** READ-ONLY storage report — writes NOTHING.
   *
   *  This is what makes the session round-trip provable. `/session` seeds its own
   *  state on load, so its marker reads "seeded" whether a restore ran or not —
   *  a false oracle one step past the one the journey was written to avoid. This
   *  page only reports, so "present after a proven-empty clear" can mean exactly
   *  one thing: the restore put it back. */
  "/session-read": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — session read</title></head><body>
<h1>Session Read</h1><p id="marker">reading</p>
<script>
  var ls = localStorage.getItem("vmark_fixture_key");
  var ck = /(?:^|;\\s*)vmark_fixture_session=([^;]*)/.exec(document.cookie);
  document.getElementById("marker").textContent =
    "read:ls=" + (ls || "none") + ";cookie=" + (ck ? ck[1] : "none");
</script>
</body></html>`,

  /** Writes cookie + localStorage so a session round-trip has something real to
   *  capture. The clear endpoint below proves absence before a restore. */
  "/session": `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — session</title></head><body>
<h1>Session Fixture</h1><p id="marker">session-loaded</p>
<script>
  document.cookie = "vmark_fixture_session=seeded; path=/; SameSite=Lax";
  localStorage.setItem("vmark_fixture_key", "seeded");
  document.getElementById("marker").textContent =
    "session-seeded:" + (localStorage.getItem("vmark_fixture_key") || "none");
</script>
</body></html>`,
};

/**
 * Start the fixture server on an OS-assigned port.
 *
 * @returns {Promise<{
 *   origin: string,
 *   url: (path: string) => string,
 *   hits: (key: string) => number,
 *   allHits: () => Record<string, number>,
 *   resetHits: () => void,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startFixtureServer() {
  /** Server-side truth about what the browser actually requested. */
  const hits = Object.create(null);
  const bump = (key) => {
    hits[key] = (hits[key] ?? 0) + 1;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    bump(path);

    // --- oracle endpoints -------------------------------------------------

    // The page calls this from a click handler; the journey asserts the counter
    // rather than trusting the act result's own `clicked: true`.
    if (path.startsWith("/hit/")) {
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }

    // Redirect chain: /redirect -> /redirected. Proves the omnibox shows the
    // COMMITTED url, not the typed one.
    if (path === "/redirect") {
      res.writeHead(302, { location: "/redirected", "cache-control": "no-store" });
      res.end();
      return;
    }

    // Redirect into private space. MUST be refused by the AI navigation policy at
    // the redirect hop — the request counter proves the hop was attempted and the
    // destination was never reached.
    if (path === "/redirect-private") {
      res.writeHead(302, { location: "http://192.168.0.1/", "cache-control": "no-store" });
      res.end();
      return;
    }

    // Never completes within the navigation budget: `stop` must prevent this
    // page's terminal marker from ever appearing.
    if (path === "/slow") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.write("<!doctype html><html><body><p id='marker'>slow-started</p>");
      // Deliberately never finished; the socket closes with the server.
      return;
    }

    // Clears cookie + localStorage so a session-restore journey can PROVE absence
    // before loading. Without this a no-op restore passes (the values simply
    // survived in the same webview store) — the single easiest way for the
    // session round-trip to prove nothing.
    if (path === "/session-clear") {
      res.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-store",
        "set-cookie": "vmark_fixture_session=; path=/; Max-Age=0",
      });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VMark fixture — cleared</title></head><body>
<h1>Cleared</h1><p id="marker">clearing</p>
<script>
  localStorage.removeItem("vmark_fixture_key");
  document.getElementById("marker").textContent =
    "session-cleared:" + (localStorage.getItem("vmark_fixture_key") || "none");
</script>
</body></html>`);
      return;
    }

    // --- pages ------------------------------------------------------------

    const body = PAGES[path];
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end("not a fixture");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 explicitly, never 0.0.0.0 — a fixture server must not be reachable
    // from the network while a security suite is pointing a browser at it.
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    url: (path) => `${origin}${path.startsWith("/") ? path : `/${path}`}`,
    hits: (key) => hits[key] ?? 0,
    allHits: () => ({ ...hits }),
    resetHits: () => {
      for (const k of Object.keys(hits)) delete hits[k];
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
