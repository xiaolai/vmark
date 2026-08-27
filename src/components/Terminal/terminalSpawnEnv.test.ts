// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  resolveLoginShellPath,
  buildShellSpawnConfig,
  buildBaseTerminalEnv,
} from "./terminalSpawnEnv";

const mockInvoke = vi.mocked(invoke);

/** Override navigator.platform for the duration of a test. */
function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", {
    value,
    configurable: true,
  });
}

describe("resolveLoginShellPath", () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("returns the login PATH from the backend when present", async () => {
    mockInvoke.mockResolvedValue("/opt/homebrew/bin:/usr/bin");
    await expect(resolveLoginShellPath()).resolves.toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_login_shell_path");
  });

  it("falls back to the POSIX default when IPC returns an empty string", async () => {
    mockInvoke.mockResolvedValue("");
    setPlatform("MacIntel");
    await expect(resolveLoginShellPath()).resolves.toBe(
      "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("falls back to the Windows default when IPC fails on Windows", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc down"));
    setPlatform("Win32");
    await expect(resolveLoginShellPath()).resolves.toBe(
      "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    );
  });

  it("falls back to the POSIX default when IPC fails on non-Windows", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc down"));
    setPlatform("Linux x86_64");
    await expect(resolveLoginShellPath()).resolves.toBe(
      "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });
});

describe("buildShellSpawnConfig (WI-3.3)", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns a fresh copy of the base env and no args when integration is disabled", async () => {
    const base = { PATH: "/usr/bin", HOME: "/home/me" };
    const result = await buildShellSpawnConfig(base, "/bin/zsh", false);

    expect(result.env).toEqual(base);
    expect(result.env).not.toBe(base); // must be a copy, not the same reference
    expect(result.args).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("merges shell-integration env onto the base env when enabled", async () => {
    mockInvoke.mockResolvedValue({ env: { ZDOTDIR: "/tmp/zsh-integration" }, args: [] });
    const base = { PATH: "/usr/bin" };

    const result = await buildShellSpawnConfig(base, "/bin/zsh", true);

    expect(result.env).toEqual({
      PATH: "/usr/bin",
      ZDOTDIR: "/tmp/zsh-integration",
    });
    expect(result.args).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("prepare_shell_integration", {
      shell: "/bin/zsh",
    });
    expect(base).toEqual({ PATH: "/usr/bin" }); // base untouched
  });

  it("carries bash's --rcfile arg through without touching the env", async () => {
    mockInvoke.mockResolvedValue({
      env: {},
      args: ["--rcfile", "/data/shell-integration/bash/vmark.bash"],
    });
    const base = { PATH: "/usr/bin" };

    const result = await buildShellSpawnConfig(base, "/bin/bash", true);

    expect(result.args).toEqual([
      "--rcfile",
      "/data/shell-integration/bash/vmark.bash",
    ]);
    expect(result.env).toEqual({ PATH: "/usr/bin" });
  });

  it("returns the base env and no args when the shell has no integration", async () => {
    mockInvoke.mockResolvedValue(null);
    const base = { PATH: "/usr/bin" };

    await expect(buildShellSpawnConfig(base, "/usr/bin/fish", true)).resolves.toEqual({
      env: { PATH: "/usr/bin" },
      args: [],
    });
  });

  it("spawns without integration when preparation throws", async () => {
    mockInvoke.mockRejectedValue(new Error("integration unavailable"));
    const base = { PATH: "/usr/bin" };

    await expect(buildShellSpawnConfig(base, "/bin/fish", true)).resolves.toEqual({
      env: { PATH: "/usr/bin" },
      args: [],
    });
  });

  it("tolerates a payload missing either field", async () => {
    // Zero-trust at the IPC boundary — a partial payload must not become
    // `spawn(shell, undefined)`.
    mockInvoke.mockResolvedValue({ env: { A: "1" } });
    await expect(buildShellSpawnConfig({}, "/bin/zsh", true)).resolves.toEqual({
      env: { A: "1" },
      args: [],
    });

    mockInvoke.mockResolvedValue({ args: ["--rcfile", "/x"] });
    await expect(buildShellSpawnConfig({}, "/bin/bash", true)).resolves.toEqual({
      env: {},
      args: ["--rcfile", "/x"],
    });
  });

  it("drops non-string entries from a malformed args array", async () => {
    mockInvoke.mockResolvedValue({ env: {}, args: ["--rcfile", 42, null, "/x"] });
    const result = await buildShellSpawnConfig({}, "/bin/bash", true);
    expect(result.args).toEqual(["--rcfile", "/x"]);
  });

  it("ignores a non-array args value entirely", async () => {
    mockInvoke.mockResolvedValue({ env: {}, args: "--rcfile /x" });
    const result = await buildShellSpawnConfig({}, "/bin/bash", true);
    expect(result.args).toEqual([]);
  });
});

describe("buildBaseTerminalEnv", () => {
  const originalPlatform = navigator.platform;
  afterEach(() => setPlatform(originalPlatform));

  it("states the terminal's identity and colour capability", () => {
    const env = buildBaseTerminalEnv("/usr/bin", undefined);
    expect(env.TERM).toBe("xterm-256color");
    // ADR-006: CLI tools with terminal allowlists (Claude Code's
    // /terminal-setup) enable CSI-u only for terminals they recognize.
    expect(env.TERM_PROGRAM).toBe("WezTerm");
  });

  it("advertises 24-bit colour on every platform (#1334)", () => {
    // xterm.js renders SGR 38;2;r;g;b, but with COLORTERM empty a CLI tool has
    // no way to know that and downgrades to the 256-colour palette.
    for (const platform of ["MacIntel", "Linux x86_64", "Win32"]) {
      setPlatform(platform);
      expect(buildBaseTerminalEnv("/usr/bin", undefined).COLORTERM).toBe("truecolor");
    }
  });

  it("passes the login shell PATH through", () => {
    expect(buildBaseTerminalEnv("/opt/homebrew/bin:/usr/bin", undefined).PATH).toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
  });

  // #1334: "UTF-8" is a locale name on Darwin (/usr/share/locale/UTF-8) and is
  // NOT one on glibc. Exporting it on Linux replaced a perfectly good inherited
  // locale with an invalid one, so every child calling setlocale() failed —
  // "locale: Cannot set LC_CTYPE to default locale: No such file or directory",
  // and `manpath: can't set the locale` on every prompt.
  it.each([
    ["MacIntel", true],
    ["Linux x86_64", false],
    ["Win32", false],
  ])("platform=%s → sets LC_CTYPE=UTF-8: %s", (platform, expected) => {
    setPlatform(platform);
    const env = buildBaseTerminalEnv("/usr/bin", undefined);
    if (expected) expect(env.LC_CTYPE).toBe("UTF-8");
    else expect(env).not.toHaveProperty("LC_CTYPE");
  });

  it("exposes the workspace root only when one is open", () => {
    expect(buildBaseTerminalEnv("/usr/bin", "/my/workspace").VMARK_WORKSPACE).toBe(
      "/my/workspace",
    );
    expect(buildBaseTerminalEnv("/usr/bin", undefined)).not.toHaveProperty(
      "VMARK_WORKSPACE",
    );
  });

  it("never sets EDITOR (T1/D1)", () => {
    // Forcing EDITOR=vmark could never work — the shim is opt-in, macOS-only,
    // and returns immediately, so `git commit` aborts with an empty message.
    for (const platform of ["MacIntel", "Linux x86_64", "Win32"]) {
      setPlatform(platform);
      expect(buildBaseTerminalEnv("/usr/bin", "/ws")).not.toHaveProperty("EDITOR");
    }
  });
});
