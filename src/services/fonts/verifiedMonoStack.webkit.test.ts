/**
 * Real-WebKit tier — the mono stack must actually BE monospace (#1334).
 *
 * jsdom has no font engine, so it cannot see this class at all: every stack
 * "resolves" and every measurement is zero.
 *
 * **The failure condition here is constructed, not borrowed from the host.**
 * The previous version of this guard measured VMark's real stacks and asserted
 * they came out monospace — which is true on any machine WITHOUT a CJK locale,
 * so it passed on macOS and on CI's Linux WebKit while the bug was live. Green
 * meant "not exercised". This version leads a stack with `sans-serif`: a
 * generic that always resolves and is always proportional, on every engine and
 * every font configuration. If `narrowToMonospace` stops working, this fails
 * everywhere rather than only where someone happens to read Chinese.
 */
import { describe, it, expect } from "vitest";
import {
  narrowToMonospace,
  stackRendersMonospace,
  verifiedMonoStack,
} from "./verifiedMonoStack";
import { getRuntimePlatform } from "@/utils/platform";

describe("mono stack verification in real WebKit", () => {
  it("measures a proportional generic as NOT monospace", () => {
    // Guards the measurement itself. Without this, a probe that always reported
    // "monospace" would make every assertion below vacuously true — which is
    // exactly how the previous guard failed.
    expect(stackRendersMonospace("sans-serif")).toBe(false);
  });

  it("measures a monospace generic as monospace", () => {
    expect(stackRendersMonospace("monospace")).toBe(true);
  });

  it("drops a proportional head family it can actually see", () => {
    // The constructed reproduction of the reported bug: a head family that
    // resolves but is not monospace must not survive verification.
    expect(narrowToMonospace("sans-serif, monospace")).toBe("monospace");
  });

  it("keeps a monospace head family", () => {
    expect(narrowToMonospace("monospace, sans-serif")).toBe("monospace, sans-serif");
  });

  it("yields a monospace stack for every mono setting on this platform", () => {
    const platform = getRuntimePlatform();
    for (const key of ["system", "sfmono", "menlo", "consolas", "jetbrains", "dejavu"]) {
      expect(stackRendersMonospace(verifiedMonoStack(key, platform))).toBe(true);
    }
  });
});
