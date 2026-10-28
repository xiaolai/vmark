// @vitest-environment node
// A Save As destination is judged in a fixed order — the path guard, then approval, then the overwrite probe — and the first refusal wins, naming the toast it owes the user; the tab's own path (by file identity, not spelling) needs no approval and is never probed. Edge cases: a denied path with approval off (no probe), approval off over an existing file (approval, not overwrite), the tab's own path with approval off over an existing file, a case-variant of the own path on Windows (folded) and macOS (not), a dot-segment spelling, an untitled tab, a CJK file name, a path with no file name
import { describe, it, expect, vi } from "vitest";
import type { RuntimePlatform } from "@/utils/platform";
import { resolveSaveAsDestination, type SaveAsProbes } from "../saveAsDestination";

function probes(o: { allowed?: boolean; autoApprove?: boolean; existing?: boolean; platform?: RuntimePlatform } = {}) {
  const p: SaveAsProbes = {
    checkPath: vi.fn(async () => (o.allowed === false ? { allowed: false as const, reason: "outside the allowed roots" } : { allowed: true as const })),
    exists: vi.fn(async () => o.existing ?? false),
    autoApprove: () => o.autoApprove ?? true,
    platform: o.platform ?? "macos",
  };
  return p;
}

const OWN = "/docs/笔记.md";

describe("resolveSaveAsDestination", () => {
  it.each([
    ["a denied path before approval", "/etc/x.md", OWN, { allowed: false, autoApprove: false, existing: true }, "INVALID_PATH", null],
    ["approval before the overwrite probe", "/docs/其他.md", OWN, { autoApprove: false, existing: true }, "APPROVAL_REQUIRED", "approval"],
    ["approval for an untitled tab", "/docs/new.md", null, { autoApprove: false }, "APPROVAL_REQUIRED", "approval"],
    ["an existing file with approval on", "/docs/其他.md", OWN, { existing: true }, "APPROVAL_REQUIRED", "overwrite"],
    ["a case-variant of the own path on macOS", "/docs/A.md", "/docs/a.md", { autoApprove: false, existing: true }, "APPROVAL_REQUIRED", "approval"],
  ] as const)("refuses %s", async (_name, target, own, o, error, toast) => {
    const p = probes(o);
    const out = await resolveSaveAsDestination(target, own, p);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.error).toBe(error);
    expect(!out.ok && out.toast).toBe(toast);
    if (error !== "APPROVAL_REQUIRED" || toast === "approval") expect(p.exists).not.toHaveBeenCalled();
  });

  it("names the existing file in the overwrite refusal", async () => {
    const out = await resolveSaveAsDestination("/docs/其他.md", OWN, probes({ existing: true }));
    expect(!out.ok && out.error.message).toContain("其他.md");
  });

  it.each([
    ["the tab's own path, approval off, file present", OWN, OWN, { autoApprove: false, existing: true }, true],
    ["a case-variant of the own path on Windows", "C:/docs/A.md", "C:/docs/a.md", { autoApprove: false, existing: true, platform: "windows" }, true],
    ["a dot-segment spelling of the own path", "/docs/./笔记.md", OWN, { autoApprove: false, existing: true }, true],
    ["a new file with approval on", "/docs/新.md", OWN, {}, false],
  ] as const)("admits %s", async (_name, target, own, o, sameOpenPath) => {
    const p = probes(o);
    const out = await resolveSaveAsDestination(target, own, p);
    expect(out).toEqual({ ok: true, sameOpenPath, name: target.split("/").pop() });
    if (sameOpenPath) expect(p.exists).not.toHaveBeenCalled();
  });

  it("falls back to the whole path when it names no file", async () => {
    const out = await resolveSaveAsDestination("/", OWN, probes({ autoApprove: false }));
    expect(!out.ok && out.name).toBe("/");
  });
});
