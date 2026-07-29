/**
 * ADR-9 auth: one-time nonce → HttpOnly session cookie.
 *
 * A per-request header scheme is impossible for the external browser, static
 * assets, SSE, and Slidev HMR (review D1.2). And the long-lived port-file token
 * must never appear in a URL (browser history) — security review VULN-001.
 *
 * Flow:
 *   1. VMark (which holds the port-file `bootstrapToken`) calls `GET /__mint`
 *      with `Authorization: Bearer <bootstrapToken>` → receives a single-use,
 *      short-TTL nonce. This is a loopback fetch (no browser history).
 *   2. VMark navigates the webview/browser to `/__auth?t=<nonce>`. The server
 *      validates the nonce (single-use + TTL), sets an HttpOnly, SameSite=Strict
 *      session cookie, and redirects. The long-lived token is never in a URL.
 *   3. All later requests authenticate via the cookie.
 *
 * @module server/auth
 */

import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "vmark_cs_session";
const BOOTSTRAP_PARAM = "t";
/** One-time nonce lifetime. */
export const NONCE_TTL_MS = 120_000;

/** Constant-time string compare to avoid timing oracles. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AuthGuard {
  middleware: ReturnType<typeof createMiddleware>;
  /** `GET /__mint` — Bearer-authed; returns `{ nonce }`. */
  handleMint: (c: import("hono").Context) => Response | Promise<Response>;
  /** `GET /__auth?t=<nonce>` — consumes a nonce, sets the session cookie. */
  handleBootstrap: (c: import("hono").Context) => Response | Promise<Response>;
  /** Mint a one-time nonce directly (used by tests / in-process callers). */
  mintNonce: (now?: number) => string;
  /** True if the request carries the correct `Authorization: Bearer <bootstrap>`. */
  checkBearer: (c: import("hono").Context) => boolean;
  readonly sessionToken: string;
}

export interface AuthOptions {
  bootstrapToken: string;
  redirectTo?: string;
  /** Injectable clock for deterministic TTL tests. */
  now?: () => number;
}

export function createAuthGuard(options: AuthOptions): AuthGuard {
  const sessionToken = randomBytes(32).toString("hex");
  const redirectTo = options.redirectTo ?? "/";
  const clock = options.now ?? (() => Date.now());
  /** nonce → expiry epoch ms (single-use: deleted on consume). */
  const nonces = new Map<string, number>();

  const mintNonce = (now = clock()): string => {
    // grill L2 — evict expired nonces on each mint so the map can't grow
    // unbounded under mint-without-consume.
    for (const [n, expiry] of nonces) if (expiry <= now) nonces.delete(n);
    const nonce = randomBytes(32).toString("hex");
    nonces.set(nonce, now + NONCE_TTL_MS);
    return nonce;
  };

  const consumeNonce = (nonce: string, now = clock()): boolean => {
    const expiry = nonces.get(nonce);
    if (expiry === undefined) return false;
    nonces.delete(nonce); // single-use regardless of outcome
    return expiry > now;
  };

  const bearer = (c: import("hono").Context): string | null => {
    const h = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1] : null;
  };

  const middleware = createMiddleware(async (c, next) => {
    const p = c.req.path;
    if (p === "/__auth" || p === "/__mint") return next(); // self-authenticating
    // Accept the cookie (external browser — first-party cookies work) OR a
    // session token in `?s=`. The query path is REQUIRED for the in-app
    // cross-site iframe: WKWebView's ITP blocks third-party cookie STORAGE for
    // a cross-site loopback origin, so a cookie can never be set there — the URL
    // session token is the only viable credential (grill M2, found via E2E).
    const cookie = getCookie(c, SESSION_COOKIE);
    const queryToken = c.req.query("s");
    const ok =
      (cookie != null && safeEqual(cookie, sessionToken)) ||
      (queryToken != null && safeEqual(queryToken, sessionToken));
    if (!ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  const handleMint = (c: import("hono").Context): Response => {
    const provided = bearer(c);
    if (!provided || !safeEqual(provided, options.bootstrapToken)) {
      return c.json({ error: "invalid bootstrap token" }, 403);
    }
    return c.json({ nonce: mintNonce() });
  };

  const handleBootstrap = (c: import("hono").Context): Response => {
    const provided = c.req.query(BOOTSTRAP_PARAM) ?? "";
    if (!provided || !consumeNonce(provided)) {
      return c.json({ error: "invalid or expired nonce" }, 403);
    }
    // Set the cookie (external browser) AND carry the session token in the
    // redirect URL (the cookie-blocked in-app iframe).
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
    });
    // Optional same-origin `next` path (e.g. /slidev/) — reject anything that
    // isn't a single-leading-slash relative path (no `//` open-redirect).
    const next = c.req.query("next");
    const dest = next && /^\/[^/]/.test(next) ? next : redirectTo;
    const sep = dest.includes("?") ? "&" : "?";
    return c.redirect(`${dest}${sep}s=${sessionToken}`, 302);
  };

  const checkBearer = (c: import("hono").Context): boolean => {
    const provided = bearer(c);
    return provided != null && safeEqual(provided, options.bootstrapToken);
  };

  return { middleware, handleMint, handleBootstrap, mintNonce, checkBearer, sessionToken };
}
