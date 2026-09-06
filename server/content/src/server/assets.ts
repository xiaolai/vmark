/**
 * Inlined client assets for the served KB site (grill H6 — the shell links
 * these). Kept inline to avoid filesystem/path-in-bundle concerns.
 *
 * `KB_JS` wires the SSE live-reload end-to-end: the served page subscribes to
 * `/__events` and reloads on a `reload` event. Mermaid/Markmap client bundles
 * are a documented follow-up (they would be appended here / served from a
 * separate route).
 *
 * @module server/assets
 */

export const KB_CSS = `
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
.kb-index { list-style: none; padding: 0; }
.kb-index a, a.wiki-link { text-decoration: none; }
a.wiki-link--missing { color: #b91c1c; border-bottom: 1px dashed currentColor; }
.markdown-alert { border-left: 4px solid #888; padding: 0.25rem 1rem; margin: 1rem 0; }
.markdown-alert-note { border-color: #0969da; }
.markdown-alert-tip { border-color: #1a7f37; }
.markdown-alert-important { border-color: #8250df; }
.markdown-alert-warning { border-color: #9a6700; }
.markdown-alert-caution { border-color: #cf222e; }
pre { overflow-x: auto; }
`.trim();

export const KB_JS = `
(function () {
  // Session token from ?s= (in-app iframe path where cookies are blocked).
  var s = new URLSearchParams(location.search).get("s");
  var suffix = s ? "?s=" + encodeURIComponent(s) : "";
  try {
    var es = new EventSource("/__events" + suffix);
    es.addEventListener("reload", function () { location.reload(); });
  } catch (e) { /* SSE unavailable — static view */ }
  if (s) {
    // Propagate the session token to same-origin navigations so links work
    // inside the cookie-blocked iframe (grill M2).
    document.addEventListener("DOMContentLoaded", function () {
      // EVERY link, not just 'a[href^="/"]'. An ordinary markdown link is
      // RELATIVE — [Next](B.md), [Parent](../B.md) — so the old selector
      // matched none of them, and following one inside the cookie-blocked
      // in-app iframe dropped ?s and returned 401 (audit 20260906, MCP-C02).
      // Only wiki-links, which already emit absolute /note/ URLs, ever worked.
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var raw = links[i].getAttribute("href");
        if (!raw) continue;
        // Fragment-only: same document, no request, nothing to carry.
        if (raw.charAt(0) === "#") continue;
        // Protocol-relative ("//host") is cross-origin by construction.
        if (raw.charAt(0) === "/" && raw.charAt(1) === "/") continue;
        try {
          // Resolved against location.href, NOT location.origin: a relative
          // href is relative to the DOCUMENT, so "B.md" on /note/dir/A.md is
          // /note/dir/B.md. Resolving against the origin would send it to /B.md.
          var u = new URL(raw, location.href);
          if (u.origin !== location.origin) continue;
          // mailto:, javascript:, data: never carry a session.
          if (u.protocol !== "http:" && u.protocol !== "https:") continue;
          // Set ?s before any #fragment and preserve existing query params.
          u.searchParams.set("s", s);
          links[i].setAttribute("href", u.pathname + u.search + u.hash);
        } catch (e) { /* leave malformed hrefs untouched */ }
      }
    });
  }
  // Progressive enhancement: render diagram placeholders if a Mermaid/Markmap
  // bundle has been loaded on the page. The renderer emits the source inside
  // <pre class="mermaid|markmap">; when the bundle is absent the source stays
  // visible as text rather than breaking the page (WI-3.2 / H-5).
  document.addEventListener("DOMContentLoaded", function () {
    if (window.mermaid && typeof window.mermaid.run === "function") {
      // run() is async — guard the returned promise, not just sync throws.
      try { Promise.resolve(window.mermaid.run({ querySelector: "pre.mermaid" })).catch(function () {}); } catch (e) {}
    }
  });
})();
`.trim();
