// Phase 7 — Slidev export arg-building + spawn success/failure (injected spawn).
import { describe, it, expect, vi } from "vitest";
import { buildExportArgs, runSlidevExport } from "./export";

describe("buildExportArgs", () => {
  it("builds the export command", () => {
    expect(buildExportArgs("/d/talk.md", "pdf", "/out/talk.pdf")).toEqual([
      "export",
      "/d/talk.md",
      "--format",
      "pdf",
      "--output",
      "/out/talk.pdf",
    ]);
  });
  it.each(["pdf", "png", "pptx"] as const)("supports %s", (fmt) => {
    expect(buildExportArgs("/d.md", fmt, "/o")[3]).toBe(fmt);
  });
});

function fakeSpawn(exitCode: number, stderr = "") {
  return vi.fn(() => {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const child = {
      stderr: { on: (_e: "data", cb: (d: unknown) => void) => { if (stderr) cb(stderr); } },
      on: (e: string, cb: (arg: unknown) => void) => {
        handlers[e] = cb;
        if (e === "exit") setTimeout(() => cb(exitCode), 0);
      },
    };
    return child as never;
  });
}

describe("runSlidevExport", () => {
  it("resolves with the output path on success", async () => {
    const spawn = fakeSpawn(0);
    const out = await runSlidevExport("/d/talk.md", "pdf", "/out.pdf", {
      spawn,
      resolveEntry: () => "/slidev.mjs",
      nodeExe: "node",
    });
    expect(out).toBe("/out.pdf");
    expect(spawn).toHaveBeenCalledWith(
      "node",
      ["/slidev.mjs", "export", "/d/talk.md", "--format", "pdf", "--output", "/out.pdf"],
      { cwd: "/d" }
    );
  });

  it("rejects with stderr on non-zero exit (e.g. missing Chromium)", async () => {
    const spawn = fakeSpawn(1, "Executable doesn't exist: chromium");
    await expect(
      runSlidevExport("/d.md", "pdf", "/o.pdf", {
        spawn,
        resolveEntry: () => "/slidev.mjs",
      })
    ).rejects.toThrow(/chromium/);
  });
});
