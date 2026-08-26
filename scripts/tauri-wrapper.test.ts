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
import { describe, it, expect, vi } from "vitest";
import {
  checkSidecarPresent,
  expectedSidecarName,
  parseTauriArgs,
  runTauri,
} from "./tauri-wrapper.mjs";

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

describe("parseTauriArgs", () => {
  it("takes the first non-flag token as the subcommand", () => {
    expect(parseTauriArgs(["dev"]).subcommand).toBe("dev");
    expect(parseTauriArgs(["build", "--debug"]).subcommand).toBe("build");
  });

  it("skips global flags before the subcommand — clap parses them, so must we", () => {
    expect(parseTauriArgs(["--verbose", "dev"]).subcommand).toBe("dev");
    expect(parseTauriArgs(["-v", "-v", "build"]).subcommand).toBe("build");
  });

  it("has no subcommand when only flags are present", () => {
    expect(parseTauriArgs(["--help"]).subcommand).toBeNull();
    expect(parseTauriArgs([]).subcommand).toBeNull();
  });

  it.each([
    { name: "separate --config", args: ["dev", "--config", "my.json"] },
    { name: "equals --config=", args: ["dev", "--config=my.json"] },
    { name: "separate -c", args: ["dev", "-c", "my.json"] },
    { name: "attached -cmy.json", args: ["dev", "-cmy.json"] },
    { name: "equals -c=my.json", args: ["dev", "-c=my.json"] },
  ])("detects a caller-supplied config as $name", ({ args }) => {
    expect(parseTauriArgs(args).hasConfig).toBe(true);
  });

  it("does not misread unrelated flags as a config", () => {
    expect(parseTauriArgs(["dev", "--verbose", "--component"]).hasConfig).toBe(false);
  });

  it.each([
    { name: "separate --target", args: ["build", "--target", "x86_64-pc-windows-msvc"] },
    { name: "equals --target=", args: ["build", "--target=x86_64-pc-windows-msvc"] },
    { name: "separate -t", args: ["build", "-t", "x86_64-pc-windows-msvc"] },
    { name: "equals -t=", args: ["build", "-t=x86_64-pc-windows-msvc"] },
  ])("extracts the requested build target from $name", ({ args }) => {
    expect(parseTauriArgs(args).target).toBe("x86_64-pc-windows-msvc");
  });

  it("has a null target when none was requested", () => {
    expect(parseTauriArgs(["build"]).target).toBeNull();
  });
});

describe("runTauri", () => {
  const darwinHost = { platform: "darwin", arch: "arm64" };
  const DEV_CONFIG = ["--config", "src-tauri/tauri.dev.conf.json"];

  function harness({
    sidecarPresent = true,
    status = 0,
    error,
  }: { sidecarPresent?: boolean; status?: number | null; error?: Error } = {}) {
    const existsFn = vi.fn(() => sidecarPresent);
    const spawnFn = vi.fn(() => ({ status, error }));
    return { existsFn, spawnFn };
  }

  it("appends the dev config to `dev` when the caller supplied none", () => {
    const { existsFn, spawnFn } = harness();
    const outcome = runTauri({ args: ["dev"], env: darwinHost, spawnFn, existsFn });
    expect(outcome.argv).toEqual(["dev", ...DEV_CONFIG]);
    expect(outcome.exitCode).toBe(0);
  });

  it("still applies the dev config when a global flag precedes the subcommand", () => {
    // `tauri --verbose dev` is valid clap input; reading args[0] missed the
    // subcommand entirely, skipping both the preflight and the dev config.
    const { existsFn, spawnFn } = harness();
    const outcome = runTauri({ args: ["--verbose", "dev"], env: darwinHost, spawnFn, existsFn });
    expect(outcome.argv).toEqual(["--verbose", "dev", ...DEV_CONFIG]);
    expect(existsFn).toHaveBeenCalled();
  });

  it.each([
    ["--config", "my.json"],
    ["--config=my.json"],
    ["-c", "my.json"],
    ["-cmy.json"],
  ])("never appends its config after a caller-supplied one (%s)", (...configArgs) => {
    // Tauri merges configs in ORDER, so appending the dev config after the
    // user's silently overrode it.
    const { existsFn, spawnFn } = harness();
    const args = ["dev", ...configArgs];
    const outcome = runTauri({ args, env: darwinHost, spawnFn, existsFn });
    expect(outcome.argv).toEqual(args);
  });

  it("checks the sidecar for `build` but does not touch the args", () => {
    const { existsFn, spawnFn } = harness();
    const outcome = runTauri({ args: ["build"], env: darwinHost, spawnFn, existsFn });
    expect(existsFn).toHaveBeenCalledWith("vmark-mcp-server-aarch64-apple-darwin");
    expect(outcome.argv).toEqual(["build"]);
  });

  it("skips the preflight for subcommands that do not bundle the sidecar", () => {
    const { existsFn, spawnFn } = harness();
    const outcome = runTauri({ args: ["icon", "app-icon.png"], env: darwinHost, spawnFn, existsFn });
    expect(existsFn).not.toHaveBeenCalled();
    expect(outcome.argv).toEqual(["icon", "app-icon.png"]);
  });

  it("refuses with exit 1 and the build command when the sidecar is missing", () => {
    const { existsFn, spawnFn } = harness({ sidecarPresent: false });
    const outcome = runTauri({ args: ["dev"], env: darwinHost, spawnFn, existsFn });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.argv).toBeNull();
    expect(outcome.message).toContain("pnpm --dir server/mcp build:sidecar");
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("preflights the REQUESTED target's sidecar, not the host's", () => {
    // `tauri build --target x86_64-pc-windows-msvc` on a mac bundles the
    // Windows sidecar; checking the host binary verified the wrong file.
    const { existsFn, spawnFn } = harness();
    runTauri({
      args: ["build", "--target", "x86_64-pc-windows-msvc"],
      env: darwinHost,
      spawnFn,
      existsFn,
    });
    expect(existsFn).toHaveBeenCalledWith("vmark-mcp-server-x86_64-pc-windows-msvc.exe");
  });

  it("maps the equals and short target forms too", () => {
    const a = harness();
    runTauri({
      args: ["build", "--target=aarch64-apple-darwin"],
      env: { platform: "linux", arch: "x64" },
      spawnFn: a.spawnFn,
      existsFn: a.existsFn,
    });
    expect(a.existsFn).toHaveBeenCalledWith("vmark-mcp-server-aarch64-apple-darwin");

    const b = harness();
    runTauri({
      args: ["build", "-t", "x86_64-unknown-linux-gnu"],
      env: darwinHost,
      spawnFn: b.spawnFn,
      existsFn: b.existsFn,
    });
    expect(b.existsFn).toHaveBeenCalledWith("vmark-mcp-server-x86_64-unknown-linux-gnu");
  });

  it("fails open on a target triple this repo has no sidecar for", () => {
    const { existsFn, spawnFn } = harness({ sidecarPresent: false });
    const outcome = runTauri({
      args: ["build", "--target", "universal-apple-darwin"],
      env: darwinHost,
      spawnFn,
      existsFn,
    });
    expect(outcome.exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalled();
  });

  it("propagates a spawn error as exit 1 with the error message", () => {
    const { existsFn, spawnFn } = harness({ error: new Error("ENOENT: tauri not found") });
    const outcome = runTauri({ args: ["icon"], env: darwinHost, spawnFn, existsFn });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain("ENOENT: tauri not found");
  });

  it("propagates the child's exit status, treating a null status as failure", () => {
    const ok = harness({ status: 3 });
    expect(runTauri({ args: ["icon"], env: darwinHost, ...ok }).exitCode).toBe(3);

    const killed = harness({ status: null });
    expect(runTauri({ args: ["icon"], env: darwinHost, ...killed }).exitCode).toBe(1);
  });

  // The disk advisory (scripts/dev-disk.mjs) rides along here because `dev` is
  // what grows `src-tauri/target`. It must stay strictly advisory: the whole
  // point is visibility, and a housekeeping notice that can fail a build would
  // be worse than the 149 GB it is warning about.
  describe("disk advisory", () => {
    it("prints a notice before dev without changing the exit code", () => {
      const { existsFn, spawnFn } = harness();
      const outcome = runTauri({
        args: ["dev"],
        env: darwinHost,
        spawnFn,
        existsFn,
        diskFn: () => "src-tauri/target is 149.0 GiB.",
      });
      expect(outcome.notice).toContain("149.0 GiB");
      expect(outcome.exitCode).toBe(0);
      expect(spawnFn, "the advisory must not suppress the build").toHaveBeenCalled();
    });

    it("says nothing when there is nothing to say", () => {
      const { existsFn, spawnFn } = harness();
      const outcome = runTauri({
        args: ["dev"],
        env: darwinHost,
        spawnFn,
        existsFn,
        diskFn: () => null,
      });
      expect(outcome.notice).toBeUndefined();
      expect(outcome.exitCode).toBe(0);
    });

    it("is skipped entirely for subcommands that build nothing", () => {
      const { existsFn, spawnFn } = harness();
      const diskFn = vi.fn(() => "should not appear");
      const outcome = runTauri({
        args: ["icon", "app-icon.png"],
        env: darwinHost,
        spawnFn,
        existsFn,
        diskFn,
      });
      expect(diskFn, "`tauri icon` does not touch target/").not.toHaveBeenCalled();
      expect(outcome.notice).toBeUndefined();
    });

    it("survives a probe that throws", () => {
      // Fail open. A broken advisory must never be the reason a build did not run.
      const { existsFn, spawnFn } = harness();
      const outcome = runTauri({
        args: ["dev"],
        env: darwinHost,
        spawnFn,
        existsFn,
        diskFn: () => {
          throw new Error("du exploded");
        },
      });
      expect(outcome.notice).toBeUndefined();
      expect(outcome.exitCode).toBe(0);
      expect(spawnFn).toHaveBeenCalled();
    });

    it("does not run when the sidecar preflight already refused", () => {
      // Nothing is going to be built, so measuring is pure latency.
      const { existsFn, spawnFn } = harness({ sidecarPresent: false });
      const diskFn = vi.fn(() => "should not appear");
      const outcome = runTauri({ args: ["dev"], env: darwinHost, spawnFn, existsFn, diskFn });
      expect(outcome.exitCode).toBe(1);
      expect(diskFn).not.toHaveBeenCalled();
    });

    it("defaults to no advisory when no probe is supplied", () => {
      const { existsFn, spawnFn } = harness();
      const outcome = runTauri({ args: ["dev"], env: darwinHost, spawnFn, existsFn });
      expect(outcome.notice).toBeUndefined();
      expect(outcome.exitCode).toBe(0);
    });
  });
});

/**
 * The dev config carries the DEV BUNDLE IDENTIFIER (`app.vmark.dev`), which is
 * what keeps `tauri dev` out of the installed app's profile. That makes the
 * `isDev` guard below load-bearing in a direction it was not before: applying
 * the dev config to a `build` would ship a release whose `identifier` is
 * `app.vmark.dev`, silently relocating `app_data_dir()` for every existing
 * user — settings, hot-exit session and workspaces all "gone" with no error
 * anywhere. That is a strictly worse failure than the profile collision the
 * identifier fixes, so it gets an assertion rather than a reading of the code.
 *
 * @coordinates-with src/test/devProfileIsolation.test.ts — the identifiers themselves
 */
describe("dev config is applied to `dev` and to nothing else", () => {
  const DEV_CONFIG = "src-tauri/tauri.dev.conf.json";

  /** Run the wrapper with a present sidecar and capture the argv it would spawn. */
  function argvFor(args: string[]): string[] {
    const result = runTauri({
      args,
      env: { platform: "darwin", arch: "arm64" },
      spawnFn: (argv: string[]) => {
        captured = argv;
        return { status: 0 };
      },
      existsFn: () => true,
    });
    expect(result.exitCode).toBe(0);
    return captured;
  }
  let captured: string[] = [];

  it("injects the dev config for `dev`", () => {
    expect(argvFor(["dev"])).toContain(DEV_CONFIG);
  });

  it("does NOT inject it for `build` — a release must keep the shipped identifier", () => {
    expect(argvFor(["build"])).not.toContain(DEV_CONFIG);
  });

  it("does NOT inject it for a cross-target build", () => {
    expect(argvFor(["build", "--target", "aarch64-apple-darwin"])).not.toContain(DEV_CONFIG);
  });

  it("does not override a config the caller supplied explicitly", () => {
    const argv = argvFor(["dev", "--config", "some/other.json"]);
    expect(argv).not.toContain(DEV_CONFIG);
    expect(argv).toContain("some/other.json");
  });
});
