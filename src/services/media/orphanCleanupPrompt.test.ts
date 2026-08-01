/**
 * Tests for the manual "Clean Up Unused Images" confirmation flow.
 *
 * The scanner is MOCKED here on purpose. These tests are about the decisions
 * the prompt makes — refuse, preview, confirm, re-scan, report — and driving
 * them through fake directory listings both duplicates the scanner's own suite
 * and hides which decision actually broke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import type { OrphanCleanupResult, OrphanedImage } from "./orphanAssetCleanup";

vi.mock("./orphanAssetCleanup", () => ({
  findOrphanedImages: vi.fn(),
  deleteOrphanedImages: vi.fn(),
}));

import { deleteOrphanedImages, findOrphanedImages } from "./orphanAssetCleanup";
import { runOrphanCleanup } from "./orphanCleanupPrompt";

const image = (filename: string): OrphanedImage => ({
  filename,
  fullPath: `/doc/assets/images/${filename}`,
});

function scanResult(over: Partial<OrphanCleanupResult> = {}): OrphanCleanupResult {
  return {
    orphanedImages: [],
    referencedCount: 0,
    sharedCount: 0,
    totalInFolder: 0,
    scanComplete: true,
    ...over,
  };
}

/** Text and options of the Nth `message()` call. */
const messageBody = (n = 0) => String(vi.mocked(message).mock.calls[n]?.[0] ?? "");
const messageOpts = (n = 0) =>
  vi.mocked(message).mock.calls[n]?.[1] as { kind?: string } | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findOrphanedImages).mockResolvedValue(scanResult());
  vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 0, failed: [] });
});

describe("runOrphanCleanup — refuses to guess", () => {
  it("blocks an unsaved document without scanning", async () => {
    expect(await runOrphanCleanup(null, "content")).toEqual({ status: "blocked" });
    expect(findOrphanedImages).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalled();
  });

  it("blocks a dirty document without scanning", async () => {
    expect(await runOrphanCleanup("/doc/a.md", null)).toEqual({ status: "blocked" });
    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("reports a failed scan instead of silently doing nothing", async () => {
    vi.mocked(findOrphanedImages).mockRejectedValue(new Error("EACCES"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "failed" });

    expect(messageOpts()?.kind).toBe("error");
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runOrphanCleanup — nothing to delete", () => {
  it("says everything is still referenced when the scan was complete", async () => {
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ totalInFolder: 3, referencedCount: 3 }),
    );

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "empty" });
    expect(messageOpts()?.kind).toBe("info");
    expect(messageBody()).toContain("3");
    expect(confirm).not.toHaveBeenCalled();
  });

  // An incomplete scan protects every candidate, so an empty orphan list means
  // "could not tell". Announcing it as "all referenced" is a lie the user would
  // act on by never checking again.
  it("says it could not verify when the scan was incomplete", async () => {
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ totalInFolder: 3, sharedCount: 3, scanComplete: false }),
    );

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "empty" });
    expect(messageOpts()?.kind).toBe("warning");
    expect(messageBody()).not.toBe("");
  });
});

describe("runOrphanCleanup — confirmation", () => {
  beforeEach(() => {
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }),
    );
  });

  it("deletes nothing when the user declines", async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "cancelled" });

    // Checking only the return value would pass a regression that deleted the
    // files and then returned "cancelled".
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
  });

  it("deletes on confirmation and reports the count", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }),
    );
    vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 1, failed: [] });

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({
      status: "completed",
      deleted: 1,
      failed: 0,
    });
    expect(deleteOrphanedImages).toHaveBeenCalledWith([image("a.png")]);
  });

  it("lists at most ten filenames, then a remainder", async () => {
    const many = Array.from({ length: 14 }, (_, i) => image(`f${i}.png`));
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: many, totalInFolder: 14 }),
    );
    vi.mocked(confirm).mockResolvedValue(false);

    await runOrphanCleanup("/doc/a.md", "x");

    const body = String(vi.mocked(confirm).mock.calls[0][0]);
    expect(body).toContain("f9.png");
    expect(body).not.toContain("f10.png");
    expect(body).toContain("4");
  });

  it("tells the user auto-cleanup will handle these when it is on", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    await runOrphanCleanup("/doc/a.md", "x", true);
    const withAuto = String(vi.mocked(confirm).mock.calls[0][0]);

    vi.mocked(confirm).mockClear();
    await runOrphanCleanup("/doc/a.md", "x", false);
    const withoutAuto = String(vi.mocked(confirm).mock.calls[0][0]);

    expect(withAuto).not.toBe(withoutAuto);
  });
});

// The dialog can sit open for minutes. Another window pasting into this folder,
// or the user re-adding the image, must not be deleted off a stale list.
describe("runOrphanCleanup — re-scans before deleting", () => {
  beforeEach(() => {
    vi.mocked(confirm).mockResolvedValue(true);
  });

  it("deletes only what is STILL orphaned", async () => {
    vi.mocked(findOrphanedImages)
      .mockResolvedValueOnce(
        scanResult({ orphanedImages: [image("a.png"), image("b.png")], totalInFolder: 2 }),
      )
      // b.png got referenced again while the dialog was open.
      .mockResolvedValueOnce(scanResult({ orphanedImages: [image("a.png")], totalInFolder: 2 }));
    vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 1, failed: [] });

    await runOrphanCleanup("/doc/a.md", "x");

    expect(findOrphanedImages).toHaveBeenCalledTimes(2);
    expect(deleteOrphanedImages).toHaveBeenCalledWith([image("a.png")]);
  });

  it("deletes nothing when the re-scan clears every candidate", async () => {
    vi.mocked(findOrphanedImages)
      .mockResolvedValueOnce(scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }))
      .mockResolvedValueOnce(scanResult({ totalInFolder: 1, referencedCount: 1 }));

    await runOrphanCleanup("/doc/a.md", "x");

    expect(deleteOrphanedImages).toHaveBeenCalledWith([]);
  });

  it("aborts when the re-scan could not read everything", async () => {
    // An incomplete re-scan protects every candidate, so the intersection is
    // empty. Deleting nothing and reporting success would tell the user the
    // folder is clean when we simply could not check.
    vi.mocked(findOrphanedImages)
      .mockResolvedValueOnce(scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }))
      .mockResolvedValueOnce(scanResult({ totalInFolder: 1, sharedCount: 1, scanComplete: false }));

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "failed" });
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
  });

  it("threads live sibling buffers into BOTH scans", async () => {
    const live = new Map([["/doc/other.md", "![](./assets/images/a.png)"]]);
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }),
    );

    await runOrphanCleanup("/doc/a.md", "x", false, () => live);

    for (const call of vi.mocked(findOrphanedImages).mock.calls) {
      expect(call[2]).toEqual({ knownContents: live, externalRefKeys: expect.anything() });
    }
  });

  // The dialog is exactly when a sibling tab pastes something. A snapshot taken
  // before it would hide that edit from the re-scan that exists to catch it.
  it("re-reads live buffers for the second scan, not a pre-dialog snapshot", async () => {
    let current = new Map<string, string>();
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }),
    );
    vi.mocked(confirm).mockImplementation(async () => {
      // A sibling pastes while the user is deciding.
      current = new Map([["/doc/other.md", "![](./assets/images/a.png)"]]);
      return true;
    });

    await runOrphanCleanup("/doc/a.md", "x", false, () => current);

    const calls = vi.mocked(findOrphanedImages).mock.calls;
    expect(calls[0][2]!.knownContents!.size).toBe(0);
    expect(calls[1][2]!.knownContents!.get("/doc/other.md")).toBe("![](./assets/images/a.png)");
  });

  it("aborts rather than deleting off a stale list when the re-scan fails", async () => {
    vi.mocked(findOrphanedImages)
      .mockResolvedValueOnce(scanResult({ orphanedImages: [image("a.png")], totalInFolder: 1 }))
      .mockRejectedValueOnce(new Error("EACCES"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({ status: "failed" });
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runOrphanCleanup — reports deletion failures", () => {
  beforeEach(() => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(findOrphanedImages).mockResolvedValue(
      scanResult({ orphanedImages: [image("a.png"), image("b.png")], totalInFolder: 2 }),
    );
  });

  it("warns and names the failures instead of claiming success", async () => {
    vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 1, failed: ["b.png"] });

    expect(await runOrphanCleanup("/doc/a.md", "x")).toEqual({
      status: "completed",
      deleted: 1,
      failed: 1,
    });

    const last = vi.mocked(message).mock.calls.at(-1)!;
    expect((last[1] as { kind?: string }).kind).toBe("warning");
    expect(String(last[0])).toContain("b.png");
  });

  it("reports plain success when nothing failed", async () => {
    vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 2, failed: [] });

    await runOrphanCleanup("/doc/a.md", "x");

    const last = vi.mocked(message).mock.calls.at(-1)!;
    expect((last[1] as { kind?: string }).kind).toBe("info");
  });
});
