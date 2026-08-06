/**
 * Tests for the CLI core (cliMain.ts) — argument handling, env fallback,
 * startup failure, and signal-driven idempotent shutdown, all through
 * injected dependencies.
 */
import { describe, it, expect, vi } from "vitest";
import { parseArgs, runCli, SHUTDOWN_TIMEOUT_MS, type CliDeps } from "./cliMain.js";

function makeDeps(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  const signalHandlers = new Map<string, () => void>();
  const timers: Array<() => void> = [];
  const close = vi.fn(() => Promise.resolve());
  const deps: CliDeps = {
    startServer: vi.fn(() => Promise.resolve({ url: "http://127.0.0.1:1234", close })),
    stdout: (t) => out.push(t),
    stderr: (t) => errs.push(t),
    env: {},
    exit: (code) => exits.push(code),
    onSignal: (signal, handler) => signalHandlers.set(signal, handler),
    setTimer: vi.fn((fn: () => void) => {
      timers.push(fn);
      return timers.length - 1;
    }),
    clearTimer: vi.fn(),
    version: "1.2.3",
    ...overrides,
  };
  return { deps, out, errs, exits, signalHandlers, timers, close };
}

describe("parseArgs", () => {
  it("parses all supported flags", () => {
    expect(
      parseArgs(["--root", "/kb", "--token", "t", "--port", "8080", "--port-file", "/tmp/p"])
    ).toEqual({ root: "/kb", token: "t", port: 8080, portFile: "/tmp/p" });
  });

  it("returns empty args for an empty argv", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("rejects a flag consumed as another flag's value", () => {
    expect(() => parseArgs(["--token", "--port", "8080"])).toThrow("--token requires a value");
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--rooot", "/kb"])).toThrow("Unknown argument: --rooot");
  });

  it("rejects a duplicated flag instead of last-value-wins", () => {
    expect(() => parseArgs(["--root", "/a", "--root", "/b"])).toThrow(
      "Duplicate argument: --root"
    );
  });

  it("rejects non-decimal port forms Number() would accept", () => {
    expect(() => parseArgs(["--port", "0x50"])).toThrow("--port must be a decimal integer");
    expect(() => parseArgs(["--port", "1e3"])).toThrow("--port must be a decimal integer");
    expect(() => parseArgs(["--port", " "])).toThrow("--port must be a decimal integer");
  });
});

describe("runCli", () => {
  it("prints the version and starts nothing for --version", async () => {
    const { deps, out } = makeDeps();
    await runCli(["--version"], deps);
    expect(out.join("")).toBe("1.2.3\n");
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it("exits 2 when root/token are missing", async () => {
    const { deps, errs, exits } = makeDeps();
    await runCli([], deps);
    expect(errs.join("")).toContain("--root and --token");
    expect(exits).toEqual([2]);
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it("falls back to VMARK_CS_ROOT/VMARK_CS_TOKEN env vars", async () => {
    const { deps } = makeDeps({ env: { VMARK_CS_ROOT: "/kb", VMARK_CS_TOKEN: "tok" } });
    await runCli([], deps);
    expect(deps.startServer).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/kb", bootstrapToken: "tok" })
    );
  });

  it("exits 2 on a non-integer or out-of-range --port", async () => {
    // "abc"/"-1" fail the strict decimal parse; "70000" parses but fails the
    // 0-65535 range check — both surface as exit 2 before the server starts.
    for (const [bad, message] of [
      ["abc", "--port must be a decimal integer"],
      ["-1", "--port must be a decimal integer"],
      ["70000", "--port must be an integer"],
    ] as const) {
      const { deps, errs, exits } = makeDeps();
      await runCli(["--root", "/kb", "--token", "t", "--port", bad], deps);
      expect(errs.join("")).toContain(message);
      expect(exits).toEqual([2]);
      expect(deps.startServer).not.toHaveBeenCalled();
    }
  });

  it("exits 2 with a parse error for malformed flags", async () => {
    const { deps, errs, exits } = makeDeps();
    await runCli(["--token", "--port", "8080"], deps);
    expect(errs.join("")).toContain("--token requires a value");
    expect(exits).toEqual([2]);
  });

  it("exits 1 with a fatal message when the server fails to start", async () => {
    const { deps, errs, exits } = makeDeps({
      startServer: vi.fn(() => Promise.reject(new Error("port in use"))),
    });
    await runCli(["--root", "/kb", "--token", "t"], deps);
    expect(errs.join("")).toBe("fatal: port in use\n");
    expect(exits).toEqual([1]);
  });

  it("announces the listen URL and registers both signal handlers", async () => {
    const { deps, out, signalHandlers } = makeDeps();
    await runCli(["--root", "/kb", "--token", "t"], deps);
    expect(out.join("")).toContain("listening http://127.0.0.1:1234");
    expect(signalHandlers.has("SIGINT")).toBe(true);
    expect(signalHandlers.has("SIGTERM")).toBe(true);
  });

  it("exits 1 when server.close() rejects during shutdown", async () => {
    const close = vi.fn(() => Promise.reject(new Error("socket wedged")));
    const { deps, errs, exits, signalHandlers } = makeDeps({
      startServer: vi.fn(() => Promise.resolve({ url: "http://127.0.0.1:1234", close })),
    });
    await runCli(["--root", "/kb", "--token", "t"], deps);

    signalHandlers.get("SIGINT")!();
    await Promise.resolve();
    await Promise.resolve();

    expect(errs.join("")).toContain("shutdown failed: socket wedged");
    expect(exits).toEqual([1]);
  });

  it("force-exits when server.close() never settles (watchdog)", async () => {
    // A wedged close used to latch `closing` forever — every later signal
    // ignored, process only killable with SIGKILL.
    const neverSettles = vi.fn(() => new Promise<void>(() => {}));
    const { deps, errs, exits, signalHandlers, timers } = makeDeps({
      startServer: vi.fn(() =>
        Promise.resolve({ url: "http://127.0.0.1:1234", close: neverSettles })
      ),
    });
    await runCli(["--root", "/kb", "--token", "t"], deps);

    signalHandlers.get("SIGTERM")!();
    await Promise.resolve();

    expect(deps.setTimer).toHaveBeenCalledWith(expect.any(Function), SHUTDOWN_TIMEOUT_MS);
    // Fire the armed watchdog: the process must exit 1, loudly.
    timers[0]!();
    expect(errs.join("")).toContain("shutdown timed out");
    expect(exits).toEqual([1]);
  });

  it("clears the watchdog on a clean close", async () => {
    const { deps, exits, signalHandlers } = makeDeps();
    await runCli(["--root", "/kb", "--token", "t"], deps);

    signalHandlers.get("SIGINT")!();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.clearTimer).toHaveBeenCalled();
    expect(exits).toEqual([0]);
  });

  it("shuts down idempotently: double signal closes the server once", async () => {
    const { deps, exits, signalHandlers, close } = makeDeps();
    await runCli(["--root", "/kb", "--token", "t"], deps);

    signalHandlers.get("SIGINT")!();
    signalHandlers.get("SIGTERM")!();
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });
});
