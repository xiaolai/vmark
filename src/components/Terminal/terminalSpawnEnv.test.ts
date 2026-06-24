import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveLoginShellPath, buildShellEnv } from "./terminalSpawnEnv";

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

describe("buildShellEnv", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns a fresh copy of the base env when integration is disabled", async () => {
    const base = { PATH: "/usr/bin", HOME: "/home/me" };
    const result = await buildShellEnv(base, "/bin/zsh", false);

    expect(result).toEqual(base);
    expect(result).not.toBe(base); // must be a copy, not the same reference
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("merges shell-integration overrides onto the base env when enabled", async () => {
    mockInvoke.mockResolvedValue({ ZDOTDIR: "/tmp/zsh-integration" });
    const base = { PATH: "/usr/bin" };

    const result = await buildShellEnv(base, "/bin/zsh", true);

    expect(result).toEqual({
      PATH: "/usr/bin",
      ZDOTDIR: "/tmp/zsh-integration",
    });
    expect(mockInvoke).toHaveBeenCalledWith("prepare_shell_integration", {
      shell: "/bin/zsh",
    });
    expect(base).toEqual({ PATH: "/usr/bin" }); // base untouched
  });

  it("returns the base env unchanged when overrides are null", async () => {
    mockInvoke.mockResolvedValue(null);
    const base = { PATH: "/usr/bin" };

    await expect(buildShellEnv(base, "/bin/bash", true)).resolves.toEqual({
      PATH: "/usr/bin",
    });
  });

  it("spawns without integration when preparation throws", async () => {
    mockInvoke.mockRejectedValue(new Error("integration unavailable"));
    const base = { PATH: "/usr/bin" };

    await expect(buildShellEnv(base, "/bin/fish", true)).resolves.toEqual({
      PATH: "/usr/bin",
    });
  });
});
