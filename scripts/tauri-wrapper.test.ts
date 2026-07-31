/**
 * Sidecar preflight for the Tauri wrapper.
 *
 * `tauri dev`/`build` bundle the MCP sidecar as an external binary. That binary
 * is a gitignored build artifact, so a fresh clone or worktree has an empty
 * `src-tauri/binaries/`. Cargo does not notice until the build script runs —
 * which is at 644/649, several minutes in — and the message it prints is
 *
 *   resource path `binaries/vmark-mcp-server-aarch64-apple-darwin` doesn't exist
 *
 * which names neither the sidecar nor the command that builds it. The preflight
 * turns that into a two-second failure carrying the exact command.
 *
 * @coordinates-with scripts/tauri-wrapper.mjs
 * @coordinates-with server/mcp/scripts/build-sidecar-core.mjs — TARGET_MAP (not duplicated)
 * @module scripts/tauri-wrapper.test
 */
import { describe, it, expect } from "vitest";
import { checkSidecarPresent, expectedSidecarName } from "./tauri-wrapper.mjs";

describe("expectedSidecarName", () => {
  it.each([
    { key: "darwin-arm64", expected: "vmark-mcp-server-aarch64-apple-darwin" },
    { key: "darwin-x64", expected: "vmark-mcp-server-x86_64-apple-darwin" },
    { key: "linux-x64", expected: "vmark-mcp-server-x86_64-unknown-linux-gnu" },
    { key: "win32-x64", expected: "vmark-mcp-server-x86_64-pc-windows-msvc.exe" },
  ])("maps $key to $expected", ({ key, expected }) => {
    expect(expectedSidecarName(key)).toBe(expected);
  });

  it("appends .exe only on Windows", () => {
    expect(expectedSidecarName("win32-x64").endsWith(".exe")).toBe(true);
    expect(expectedSidecarName("darwin-arm64").endsWith(".exe")).toBe(false);
  });

  it("returns null for an unsupported host rather than guessing a triple", () => {
    // Guessing would produce a filename cargo never looks for, so the preflight
    // would pass and the build would still fail at 644/649 — worse than not
    // checking, because it looks verified.
    expect(expectedSidecarName("sunos-sparc")).toBeNull();
  });
});

describe("checkSidecarPresent", () => {
  const present = (name: string) => name === "vmark-mcp-server-aarch64-apple-darwin";

  it("passes when the host's sidecar exists", () => {
    expect(checkSidecarPresent("darwin-arm64", present)).toEqual({ ok: true });
  });

  it("fails with the exact build command when it is missing", () => {
    const result = checkSidecarPresent("darwin-arm64", () => false);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("vmark-mcp-server-aarch64-apple-darwin");
    expect(result.message).toContain("pnpm --dir server/mcp build:sidecar");
  });

  it("explains WHY, not just what — the cargo error names neither", () => {
    const result = checkSidecarPresent("darwin-arm64", () => false);
    expect(result.message).toMatch(/gitignored|build artifact/i);
  });

  it("passes on an unsupported host instead of blocking the build", () => {
    // A host this repo does not ship for is not a reason to refuse: cargo may
    // still be able to build. Fail OPEN here, because the preflight's job is to
    // convert a known slow failure into a fast one, not to add a new gate.
    expect(checkSidecarPresent("sunos-sparc", () => false)).toEqual({ ok: true });
  });
});
