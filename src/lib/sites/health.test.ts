// Site plugin health checks — classify probes, run per-plugin, aggregate (WI-3.5).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-3.5
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteManifest } from "./types";
import { registerSite, __resetSiteRegistry } from "./registry";
import {
  classifyProbe,
  runSiteHealth,
  type HealthCheckFn,
  type SiteHealthProbe,
} from "./health";

const zhihu: SiteManifest = {
  id: "zhihu",
  nameI18nKey: "sites.zhihu.name",
  origins: ["https://zhihu.com"],
  capabilities: ["read", "publish"],
  minAgentApi: 1,
};
const medium: SiteManifest = {
  id: "medium",
  nameI18nKey: "sites.medium.name",
  origins: ["https://medium.com"],
  capabilities: ["read"],
  minAgentApi: 1,
};

const passing: SiteHealthProbe = { authenticated: true, fixtureExtracted: true };

beforeEach(() => __resetSiteRegistry());

describe("classifyProbe", () => {
  it("returns ok when authenticated and fixture extracted", () => {
    expect(classifyProbe({ authenticated: true, fixtureExtracted: true })).toBe("ok");
  });

  it("returns degraded when fixture extracts but session is missing", () => {
    // Public content still reads, but no logged-in session — a real, surfaceable state.
    expect(classifyProbe({ authenticated: false, fixtureExtracted: true })).toBe("degraded");
  });

  it.each([true, false])(
    "returns failed when fixture extraction fails (authenticated=%s)",
    (authenticated) => {
      // The "deliberately broken fixture" acceptance: fixture failure dominates.
      expect(classifyProbe({ authenticated, fixtureExtracted: false })).toBe("failed");
    },
  );
});

describe("runSiteHealth", () => {
  it("returns an empty list when no sites are registered", async () => {
    expect(await runSiteHealth(new Map())).toEqual([]);
  });

  it("classifies a passing plugin as ok and echoes id + capabilities", async () => {
    registerSite(zhihu);
    const checks = new Map<string, HealthCheckFn>([["zhihu", async () => passing]]);
    const health = await runSiteHealth(checks);
    expect(health).toEqual([
      { id: "zhihu", capabilities: ["read", "publish"], status: "ok" },
    ]);
  });

  it("flags a deliberately broken fixture as failed", async () => {
    registerSite(zhihu);
    const checks = new Map<string, HealthCheckFn>([
      ["zhihu", async () => ({ authenticated: true, fixtureExtracted: false, detail: "no article node" })],
    ]);
    const [health] = await runSiteHealth(checks);
    expect(health.status).toBe("failed");
    expect(health.detail).toBe("no article node");
  });

  it("marks a registered site with no health check as unknown", async () => {
    registerSite(zhihu);
    const health = await runSiteHealth(new Map());
    expect(health).toEqual([
      { id: "zhihu", capabilities: ["read", "publish"], status: "unknown" },
    ]);
  });

  it("treats a throwing health check as failed and captures the message", async () => {
    registerSite(zhihu);
    const checks = new Map<string, HealthCheckFn>([
      ["zhihu", async () => { throw new Error("probe timed out"); }],
    ]);
    const [health] = await runSiteHealth(checks);
    expect(health.status).toBe("failed");
    expect(health.detail).toBe("probe timed out");
  });

  it("captures a non-Error throw via String()", async () => {
    registerSite(zhihu);
    const checks = new Map<string, HealthCheckFn>([
      ["zhihu", () => Promise.reject("boom")],
    ]);
    const [health] = await runSiteHealth(checks);
    expect(health.status).toBe("failed");
    expect(health.detail).toBe("boom");
  });

  it("preserves registry order regardless of check completion order", async () => {
    registerSite(zhihu);
    registerSite(medium);
    // medium resolves before zhihu, but the result must still be [zhihu, medium].
    const checks = new Map<string, HealthCheckFn>([
      ["zhihu", () => new Promise((r) => setTimeout(() => r(passing), 5))],
      ["medium", async () => ({ authenticated: false, fixtureExtracted: true })],
    ]);
    const health = await runSiteHealth(checks);
    expect(health.map((h) => h.id)).toEqual(["zhihu", "medium"]);
    expect(health.map((h) => h.status)).toEqual(["ok", "degraded"]);
  });

  it("runs all checks concurrently, not one-at-a-time", async () => {
    registerSite(zhihu);
    registerSite(medium);
    const started: string[] = [];
    const mk = (id: string): HealthCheckFn => async () => {
      started.push(id);
      await Promise.resolve();
      return passing;
    };
    const checks = new Map<string, HealthCheckFn>([
      ["zhihu", mk("zhihu")],
      ["medium", mk("medium")],
    ]);
    await runSiteHealth(checks);
    // Both checks were kicked off (both ids recorded), proving fan-out.
    expect(started.sort()).toEqual(["medium", "zhihu"]);
  });

  it("omits detail when the probe supplies none", async () => {
    registerSite(medium);
    const checks = new Map<string, HealthCheckFn>([["medium", async () => passing]]);
    const [health] = await runSiteHealth(checks);
    expect(health).not.toHaveProperty("detail");
  });

  it("invokes each check exactly once", async () => {
    registerSite(zhihu);
    const check = vi.fn(async () => passing);
    await runSiteHealth(new Map<string, HealthCheckFn>([["zhihu", check]]));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
