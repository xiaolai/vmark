/**
 * KB content server (Phase 4) — Hono app: auth, note rendering, graph, search,
 * backlinks, SSE live-reload, security headers. Path reads are contained to the
 * workspace root and symlink-checked (ADR-8). Auth via the ADR-9 cookie guard.
 *
 * @module server/createServer
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createAuthGuard } from "./auth";
import { renderMarkdown } from "../render/renderMarkdown";
import { searchWorkspace } from "./search";
import { buildCsp, SECURITY_HEADERS } from "./headers";
import { KB_CSS, KB_JS } from "./assets";
import { noopLogger, type Logger } from "./logger";
import { SlidevManager } from "../slidev/manager";
import { runSlidevExport, type SlidevFormat } from "../slidev/export";
import type { WorkspaceIndex } from "../index/buildIndex";

export interface ContentServerOptions {
  root: string;
  bootstrapToken: string;
  /** Returns the current index (swapped by the watcher on change). */
  getIndex: () => WorkspaceIndex;
  /** Trusted workspaces relax the CSP img-src to allow remote images (§3bis). */
  trusted?: boolean;
  /** Structured logger; defaults to a no-op (grill H10). */
  logger?: Logger;
  /** Liveness signals surfaced by /__health (grill H10). */
  health?: () => { watcherAlive: boolean; lastError: string | null };
  /** Slidev supervisor (injectable for tests; defaults to a real one). */
  slidevManager?: SlidevManager;
  /** Slidev export deps (injectable spawn/resolver for tests). */
  exportDeps?: import("../slidev/export").ExportDeps;
}

export interface ContentServer {
  app: Hono;
  /** Push a live-reload event to all connected SSE clients. */
  notifyReload: (relPath?: string) => void;
  /** Stop any running Slidev dev servers (called on runtime shutdown). */
  stopSlidev: () => Promise<void>;
}

/** Resolve a requested note path within root; returns null on escape/garbage. */
function containedAbsPath(root: string, relRequest: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relRequest); // throws URIError on bad %-encoding
  } catch {
    return null; // grill H8 — malformed encoding → 400, not a 500
  }
  if (decoded.includes("\0")) return null; // grill M6 — reject NUL bytes
  decoded = decoded.replace(/^\/+/, "");
  const abs = path.resolve(root, decoded);
  const normRoot = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(normRoot)) return null;
  return abs;
}

/** Validate an absolute deck path is a markdown file under the real root. */
async function containedDeck(root: string, deck: string): Promise<string | null> {
  if (typeof deck !== "string" || !deck) return null;
  try {
    const real = await fs.realpath(deck);
    const realRoot = await fs.realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    if (!/\.(md|markdown|mdown|mkd)$/i.test(real)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Re-assert containment after following symlinks (grill M11). */
async function realContainedPath(root: string, abs: string): Promise<string | null> {
  try {
    const real = await fs.realpath(abs);
    const realRoot = (await fs.realpath(root)) + path.sep;
    if (real !== (await fs.realpath(root)) && !real.startsWith(realRoot)) return null;
    return real;
  } catch {
    return null; // ENOENT etc.
  }
}

function htmlShell(title: string, body: string, sessionToken: string): string {
  // Asset URLs carry ?s so the cookie-blocked in-app iframe can load them
  // (grill M2). kb.js propagates ?s to in-page links + the SSE stream.
  const q = `?s=${encodeURIComponent(sessionToken)}`;
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<link rel="stylesheet" href="/__assets/kb.css${q}">` +
    `</head><body><main class="kb-content">${body}</main>` +
    `<script src="/__assets/kb.js${q}"></script></body></html>`;
}

// grill M14 — strip Unicode bidi-control chars (RTL override etc.) so a crafted
// filename can't visually spoof entries in the served index list.
const BIDI_CONTROLS = /[‪-‮⁦-⁩‎‏]/g;

function escapeHtml(s: string): string {
  return s
    .replace(BIDI_CONTROLS, "")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * Build a `/note/<relPath>` URL with each path segment percent-encoded.
 * `encodeURI` leaves `?` and `#` intact, which would corrupt links to notes
 * whose filenames contain those characters (Codex audit).
 */
function noteHref(relPath: string): string {
  return "/note/" + relPath.split("/").map(encodeURIComponent).join("/");
}

export function createContentServer(options: ContentServerOptions): ContentServer {
  const { root, bootstrapToken, getIndex } = options;
  const log = options.logger ?? noopLogger;
  const csp = buildCsp(options.trusted ?? false);
  const auth = createAuthGuard({ bootstrapToken });
  const app = new Hono();
  const sseClients = new Set<(relPath?: string) => Promise<void>>();
  // grill M12 — render cache keyed by relPath; entries carry the file mtime so
  // a stale-by-content entry is skipped, and the whole cache is cleared on any
  // workspace change (notifyReload) so wiki-link resolution never goes stale.
  const RENDER_CACHE_MAX = 256;
  const renderCache = new Map<string, { mtimeMs: number; html: string }>();

  // Security headers on every response (grill H1/H4).
  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", csp);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  });

  const slidev = options.slidevManager ?? new SlidevManager();
  let slidevSubPort: number | null = null;
  let slidevActiveDeck: string | null = null;

  app.get("/__mint", (c) => auth.handleMint(c));
  app.get("/__auth", (c) => auth.handleBootstrap(c));

  // Slidev control plane (Bearer-authed, like /__mint — called by Rust). Starts
  // a Slidev dev server for the deck; the deck renders via the /slidev/ proxy.
  app.post("/api/slidev/preview", async (c) => {
    if (!auth.checkBearer(c)) return c.json({ error: "unauthorized" }, 403);
    let rawDeck: string;
    try {
      rawDeck = (await c.req.json<{ deck: string }>()).deck;
    } catch {
      return c.json({ error: "invalid body" }, 400);
    }
    // Codex audit: contain the deck under the workspace root — a control caller
    // must not preview files outside the workspace.
    const deck = await containedDeck(root, rawDeck);
    if (!deck) return c.json({ error: "deck not in workspace" }, 400);
    try {
      // Stop the previously-active deck so switching doesn't leak servers.
      if (slidevActiveDeck && slidevActiveDeck !== deck) {
        await slidev.stop(slidevActiveDeck);
      }
      const handle = await slidev.start(deck);
      slidevSubPort = handle.subPort;
      slidevActiveDeck = deck;
      return c.json({ ok: true, path: "/slidev/" });
    } catch (e) {
      log.error("slidev preview failed", { deck, err: String(e) });
      return c.json({ error: `slidev start failed: ${e}` }, 500);
    }
  });

  // Slidev export (Bearer-authed control call). Shells out to `slidev export`;
  // surfaces a missing-Chromium error to the caller (grill / Phase 7).
  app.post("/api/slidev/export", async (c) => {
    if (!auth.checkBearer(c)) return c.json({ error: "unauthorized" }, 403);
    let body: { deck: string; format: SlidevFormat; output: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid body" }, 400);
    }
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid body" }, 400);
    }
    // Codex audit: contain the deck under the workspace root before export.
    const deck = await containedDeck(root, body.deck);
    if (!deck) return c.json({ error: "deck not in workspace" }, 400);
    // Codex audit: constrain the output to an expected export extension so the
    // control plane can't be used to write arbitrary file types. (The path
    // itself originates from the app's trusted Save flow.)
    const okExt: Record<SlidevFormat, RegExp> = {
      pdf: /\.pdf$/i,
      png: /\.png$/i,
      pptx: /\.pptx$/i,
    };
    if (!body.output || !okExt[body.format]?.test(body.output)) {
      return c.json({ error: "output path must match the export format" }, 400);
    }
    try {
      // Wire the request's abort signal so a disconnected caller cancels the
      // export child instead of leaving it running until the timeout (WI-7.3).
      const out = await runSlidevExport(deck, body.format, body.output, {
        ...options.exportDeps,
        signal: options.exportDeps?.signal ?? c.req.raw.signal,
      });
      return c.json({ ok: true, output: out });
    } catch (e) {
      log.error("slidev export failed", { deck, err: String(e) });
      return c.json({ error: String(e instanceof Error ? e.message : e) }, 500);
    }
  });

  app.use("*", auth.middleware);

  // Reverse-proxy the Slidev dev server under the (authed) KB origin (ADR-9/C4).
  // Browser auth flows via the cookie; Slidev's own asset URLs (base=/slidev/)
  // are then authed by that first-party cookie.
  app.all("/slidev/*", async (c) => {
    if (slidevSubPort == null) return c.json({ error: "no slidev preview" }, 503);
    const url = new URL(c.req.url);
    const target = `http://127.0.0.1:${slidevSubPort}${url.pathname}${url.search}`;
    const init: RequestInit = { method: c.req.method, redirect: "manual" };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      init.body = await c.req.arrayBuffer();
    }
    try {
      const resp = await fetch(target, init);
      return new Response(resp.body, { status: resp.status, headers: resp.headers });
    } catch (e) {
      log.error("slidev proxy failed", { target, err: String(e) });
      return c.json({ error: "slidev proxy failed" }, 502);
    }
  });

  // Static client assets (grill H6 — the shell links these). Cookie-gated.
  app.get("/__assets/kb.css", (c) => c.body(KB_CSS, 200, { "content-type": "text/css" }));
  app.get("/__assets/kb.js", (c) => c.body(KB_JS, 200, { "content-type": "text/javascript" }));

  // Real health (grill H10) — can report unhealthy.
  app.get("/__health", (c) => {
    const h = options.health?.() ?? { watcherAlive: true, lastError: null };
    const status = h.lastError ? "degraded" : "ok";
    return c.json({ status, root, docs: getIndex().docs.length, ...h });
  });

  // Workspace index page.
  app.get("/", (c) => {
    const idx = getIndex();
    const items = idx.docs
      .map((d) => {
        const title = idx.refs.get(d.relPath)?.title ?? d.basename;
        return `<li><a href="${noteHref(d.relPath)}">${escapeHtml(title)}</a></li>`;
      })
      .join("");
    return c.html(
      htmlShell(
        "Workspace",
        `<h1>Workspace</h1><p><a href="/graph">Relationship graph →</a></p><ul class="kb-index">${items}</ul>`,
        auth.sessionToken
      )
    );
  });

  // Render a note.
  app.get("/note/*", async (c) => {
    const relRequest = c.req.path.slice("/note/".length);
    const abs = containedAbsPath(root, relRequest);
    if (!abs) return c.json({ error: "invalid path" }, 400);
    const real = await realContainedPath(root, abs);
    if (!real) return c.json({ error: "not found" }, 404);
    // Codex audit: key by the requested path relative to `root` (matches the
    // index/resolver keys), not the canonical `real` — they differ when the
    // workspace root is reached through a symlink.
    // NFC-normalize to match the walker's index keys (macOS volumes store NFD
    // filenames; a non-NFC URL would otherwise miss the index gate below).
    const fromRel = path.relative(root, abs).split(path.sep).join("/").normalize("NFC");
    // Only serve docs the walker admitted (markdown, non-hidden, not
    // .gitignore'd). Without this, path-containment alone would still expose
    // hidden/ignored/non-markdown files via a direct /note/ URL, defeating the
    // walk policy (Codex audit; pairs with WI-2.1 .gitignore honoring).
    if (!getIndex().refs.has(fromRel)) return c.json({ error: "not found" }, 404);
    let content: string;
    let mtimeMs: number;
    try {
      const stat = await fs.stat(real);
      mtimeMs = stat.mtimeMs;
      const cached = renderCache.get(fromRel);
      if (cached && cached.mtimeMs === mtimeMs) {
        const title = getIndex().refs.get(fromRel)?.title ?? path.basename(real);
        return c.html(htmlShell(title, cached.html, auth.sessionToken));
      }
      content = await fs.readFile(real, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return c.json({ error: "not found" }, 404);
      log.error("note read failed", { path: relRequest, code });
      return c.json({ error: "read failed" }, 500); // grill H10 — surface, don't mask EACCES as 404
    }
    const idx = getIndex();
    const html = await renderMarkdown(content, {
      resolveWikiLink: (target) => {
        const res = idx.resolver.resolve(target, fromRel);
        return res.relPath
          ? { href: noteHref(res.relPath), exists: true }
          : { href: `#${encodeURIComponent(target)}`, exists: false };
      },
    });
    // Store in the render cache (simple FIFO eviction at the cap).
    if (renderCache.size >= RENDER_CACHE_MAX) {
      const oldest = renderCache.keys().next().value;
      if (oldest !== undefined) renderCache.delete(oldest);
    }
    renderCache.set(fromRel, { mtimeMs, html });
    const title = idx.refs.get(fromRel)?.title ?? path.basename(real);
    return c.html(htmlShell(title, html, auth.sessionToken));
  });

  app.get("/api/graph", (c) => c.json(getIndex().graph));

  // Server-rendered relationship graph (WI-4.4 / M-4). A navigable, no-JS view
  // of every doc's outgoing edges + backlinks, built from the index. The
  // in-app panel renders the same data as an interactive force layout; this is
  // the browser-served, accessible counterpart.
  app.get("/graph", (c) => {
    const idx = getIndex();
    const g = idx.graph;
    // A real, navigable doc is one the walker actually indexed — NOT a phantom
    // node synthesized from an unresolved [[Missing]] wiki-link.
    const isRealDoc = (id: string): boolean => idx.refs.has(id);
    const target = (id: string): string =>
      isRealDoc(id)
        ? `<a href="${noteHref(id)}">${escapeHtml(id)}</a>`
        : `<span class="kb-graph-ref">${escapeHtml(id)}</span>`;
    const sections = g.nodes
      .filter((n) => n.type === "doc" && isRealDoc(n.id))
      .map((n) => {
        const out = g.edges.filter((e) => e.from === n.id);
        const back = g.edges.filter((e) => e.to === n.id);
        const title = idx.refs.get(n.id)?.title ?? n.label;
        const outItems = out
          .map((e) => `<li class="kb-edge kb-edge--${escapeHtml(e.kind)}">${escapeHtml(e.kind)} → ${target(e.to)}</li>`)
          .join("");
        const backItems = back
          .map((e) => `<li>← ${target(e.from)}</li>`)
          .join("");
        return (
          `<section class="kb-graph-node">` +
          `<h2><a href="${noteHref(n.id)}">${escapeHtml(title)}</a></h2>` +
          (outItems ? `<ul class="kb-graph-out">${outItems}</ul>` : "<p class=\"kb-graph-empty\">No outgoing links.</p>") +
          (backItems ? `<details><summary>Backlinks (${back.length})</summary><ul>${backItems}</ul></details>` : "") +
          `</section>`
        );
      })
      .join("");
    return c.html(htmlShell("Graph", `<h1>Relationship graph</h1>${sections}`, auth.sessionToken));
  });

  app.get("/api/backlinks/*", (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice("/api/backlinks/".length));
    } catch {
      return c.json({ error: "invalid path" }, 400); // grill H8
    }
    return c.json({ relPath: rel, backlinks: getIndex().backlinks(rel) });
  });

  app.get("/api/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const idx = getIndex();
    const titles = new Map(idx.docs.map((d) => [d.relPath, idx.refs.get(d.relPath)?.title]));
    const results = await searchWorkspace(idx.docs, q, { titles });
    return c.json({ query: q, results });
  });

  // SSE live-reload stream.
  app.get("/__events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (relPath?: string) =>
        stream.writeSSE({ event: "reload", data: relPath ?? "*" });
      sseClients.add(send);
      // Codex audit: send a `connected` hello (NOT `reload`) on open — a
      // `reload` here would make the client reload immediately in a loop.
      await stream.writeSSE({ event: "connected", data: "ok" });
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          sseClients.delete(send);
          resolve();
        });
      });
    })
  );

  return {
    app,
    notifyReload: (relPath?: string) => {
      renderCache.clear(); // grill M12 — any workspace change invalidates renders
      for (const send of sseClients) {
        // grill M4 — drop dead clients on write failure instead of leaking.
        send(relPath).catch(() => sseClients.delete(send));
      }
    },
    // Codex audit: let runtime shutdown stop any running Slidev dev servers.
    stopSlidev: () => slidev.stopAll(),
  };
}
