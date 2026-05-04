// WI-5.3 — frontend wrapper around the Rust gha_lint command tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { lintWithActionlint } from "../actionlint";

describe("lintWithActionlint", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty diagnostics when binary is missing (silent fallback)", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "binary_missing" });
    const out = await lintWithActionlint("on: push\njobs: {}");
    expect(out.binaryAvailable).toBe(false);
    expect(out.diagnostics).toEqual([]);
  });

  it("forwards diagnostics with GHA-ACTIONLINT- prefix", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      diagnostics: [
        {
          message: "shellcheck reported issue",
          kind: "shellcheck",
          line: 5,
          column: 7,
          end_line: 5,
          end_column: 12,
        },
      ],
    });
    const out = await lintWithActionlint("yaml");
    expect(out.binaryAvailable).toBe(true);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].code).toBe("GHA-ACTIONLINT-shellcheck");
    expect(out.diagnostics[0].message).toBe("shellcheck reported issue");
    expect(out.diagnostics[0].position).toEqual({
      startLine: 5,
      startCol: 7,
      endLine: 5,
      endCol: 12,
    });
  });

  it("falls back to start position when end is missing", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      diagnostics: [
        { message: "x", kind: "syntax-check", line: 3, column: 1 },
      ],
    });
    const out = await lintWithActionlint("yaml");
    expect(out.diagnostics[0].position).toEqual({
      startLine: 3,
      startCol: 1,
      endLine: 3,
      endCol: 1,
    });
  });

  it("returns empty + error when actionlint failed", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "failed",
      message: "panic at /actionlint:42",
    });
    const out = await lintWithActionlint("yaml");
    expect(out.binaryAvailable).toBe(true);
    expect(out.diagnostics).toEqual([]);
    expect(out.error).toMatch(/panic/);
  });

  it("returns empty + error when invoke itself rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri command not registered"));
    const out = await lintWithActionlint("yaml");
    expect(out.binaryAvailable).toBe(false);
    expect(out.diagnostics).toEqual([]);
    expect(out.error).toMatch(/not registered/);
  });
});
