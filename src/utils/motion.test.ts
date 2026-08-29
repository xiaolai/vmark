// WI-UI1.7 — the one owner of JS motion policy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

afterEach(() => vi.unstubAllGlobals());

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query }));
}

describe("motion policy", () => {
  it("reports the OS preference through matchMedia", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("defaults to smooth when motion is allowed", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("fails safe (no motion preference claimed) where matchMedia is absent", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
