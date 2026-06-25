// Phase 4 / VULN-001 — auth guard: nonce mint/consume, TTL, cookie flags.
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAuthGuard, SESSION_COOKIE, NONCE_TTL_MS } from "./auth";

const BOOTSTRAP = "port-file-token";

function appWith(now: () => number) {
  const guard = createAuthGuard({ bootstrapToken: BOOTSTRAP, now });
  const app = new Hono();
  app.get("/__mint", (c) => guard.handleMint(c));
  app.get("/__auth", (c) => guard.handleBootstrap(c));
  app.use("*", guard.middleware);
  app.get("/__health", (c) => c.json({ ok: true }));
  return { app, guard };
}

async function mint(app: Hono): Promise<string> {
  const res = await app.request("/__mint", { headers: { authorization: `Bearer ${BOOTSTRAP}` } });
  return ((await res.json()) as { nonce: string }).nonce;
}

describe("createAuthGuard", () => {
  it("mints a nonce only with the correct bearer", async () => {
    const { app } = appWith(() => 0);
    const ok = await app.request("/__mint", { headers: { authorization: `Bearer ${BOOTSTRAP}` } });
    expect(ok.status).toBe(200);
    const bad = await app.request("/__mint", { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(403);
    const none = await app.request("/__mint");
    expect(none.status).toBe(403);
  });

  it("sets HttpOnly + SameSite=Strict cookie on nonce bootstrap", async () => {
    const { app } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain(SESSION_COOKIE);
    expect(sc.toLowerCase()).toContain("httponly");
    expect(sc).toContain("SameSite=Strict");
  });

  it("rejects the long-lived token at /__auth (never accepted in URL)", async () => {
    const { app } = appWith(() => 0);
    const res = await app.request(`/__auth?t=${BOOTSTRAP}`, { redirect: "manual" });
    expect(res.status).toBe(403);
  });

  it("nonce is single-use", async () => {
    const { app } = appWith(() => 0);
    const nonce = await mint(app);
    expect((await app.request(`/__auth?t=${nonce}`, { redirect: "manual" })).status).toBe(302);
    expect((await app.request(`/__auth?t=${nonce}`, { redirect: "manual" })).status).toBe(403);
  });

  it("nonce expires after the TTL", async () => {
    let t = 1_000;
    const { app } = appWith(() => t);
    const nonce = await mint(app);
    t += NONCE_TTL_MS + 1; // advance past expiry
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.status).toBe(403);
  });

  it("bootstrap redirect carries the session token in ?s (grill M2)", async () => {
    const { app, guard } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe(`/?s=${guard.sessionToken}`);
  });

  it("accepts a valid ?s session token (cookie-blocked iframe path)", async () => {
    const { app, guard } = appWith(() => 0);
    const ok = await app.request(`/__health?s=${guard.sessionToken}`);
    expect(ok.status).toBe(200);
    const bad = await app.request("/__health?s=wrong");
    expect(bad.status).toBe(401);
  });
});
