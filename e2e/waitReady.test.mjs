// The readiness orchestration itself — connect, probe, retry, give up.
//
// `waitReadyArgs.test.mjs` covers argument parsing, which was all that could be
// reached without a running app. Everything the gate actually DOES was
// untested: that it probes the window it was told to, that it retries rather
// than failing on the first miss, that it exits 0 only on a completed
// handshake, and that it reports what it was stuck on. A mock bridge
// (`lib/mockBridge.mjs`) makes every one of those reachable, including states
// that are hard to produce deliberately against a real app.
//
// Spawned as a real process, because the module validates and exits at load
// time: that IS the behaviour under test.

import { execFile } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { startMockBridge } from "./lib/mockBridge.mjs";

const READY = {
  tauriEmit: true,
  tauriInvoke: true,
  appShell: true,
  windowReady: true,
};

let bridge = null;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

/** Run the gate against the mock and resolve `{ code, output }`. */
function run(port, extra = []) {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["e2e/wait-ready.mjs", "--port", String(port), "--timeout-ms", "6000", ...extra],
      { encoding: "utf8" },
      (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, output: `${stdout}${stderr}` });
      },
    );
  });
}

describe("wait-ready orchestration", () => {
  it("exits 0 when the window has completed its handshake", async () => {
    bridge = await startMockBridge((req) =>
      req.command === "list_windows"
        ? { success: true, data: [{ label: "main", isMain: true }] }
        : { success: true, data: READY },
    );

    const { code, output } = await run(bridge.port);
    expect(code, output).toBe(0);
    expect(output).toContain("completed its ready handshake");
  });

  it("probes the window it was told to, not the default one", async () => {
    // Without `windowLabel`, `execute_js` runs in the DEFAULT window — so
    // `--window doc-1` used to confirm doc-1 exists and then report MAIN's
    // readiness as doc-1's. The label check above it made that look deliberate.
    bridge = await startMockBridge((req) =>
      req.command === "list_windows"
        ? { success: true, data: [{ label: "main" }, { label: "doc-1" }] }
        : { success: true, data: READY },
    );

    const { code, output } = await run(bridge.port, ["--window", "doc-1"]);
    expect(code, output).toBe(0);
    const probe = bridge.requests.find((r) => r.command === "execute_js");
    expect(probe.args.windowLabel).toBe("doc-1");
  });

  it("keeps waiting while the window it wants is missing", async () => {
    bridge = await startMockBridge((req) =>
      req.command === "list_windows"
        ? { success: true, data: [{ label: "main" }] }
        : { success: true, data: READY },
    );

    const { code, output } = await run(bridge.port, ["--window", "doc-9"]);
    expect(code, output).toBe(1);
    expect(output).toContain("not among");
    // It RETRIED rather than giving up on the first miss.
    expect(bridge.requests.filter((r) => r.command === "list_windows").length)
      .toBeGreaterThan(1);
  });

  it("succeeds once a late window appears", async () => {
    // The whole reason the gate is a loop: a window that is not there yet is
    // the normal state during app startup, not a failure.
    let calls = 0;
    bridge = await startMockBridge((req) => {
      if (req.command !== "list_windows") return { success: true, data: READY };
      calls += 1;
      return { success: true, data: calls < 3 ? [] : [{ label: "main" }] };
    });

    const { code, output } = await run(bridge.port);
    expect(code, output).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("does not report ready on a window that has not finished its handshake", async () => {
    // Every gap here is a state in which the app is listening for NOTHING yet.
    // Each was once treated as ready by some earlier proxy for this check.
    bridge = await startMockBridge((req) =>
      req.command === "list_windows"
        ? { success: true, data: [{ label: "main" }] }
        : { success: true, data: { ...READY, windowReady: false } },
    );

    const { code, output } = await run(bridge.port);
    expect(code, output).toBe(1);
    expect(output).toContain("has not completed its ready handshake");
  });

  it("reports a bridge-level failure instead of treating it as not-yet-ready", async () => {
    bridge = await startMockBridge((req) =>
      req.command === "list_windows"
        ? { success: true, data: [{ label: "main" }] }
        : { success: false, error: "webview gone" },
    );

    const { code, output } = await run(bridge.port);
    expect(code, output).toBe(1);
    expect(output).toContain("webview gone");
  });

  it("fails with a diagnosis when nothing is listening at all", async () => {
    // No bridge started. The message must name the connection, because "app
    // never became drivable" against a healthy app is the misdiagnosis this
    // gate exists to avoid sending anyone chasing.
    const { code, output } = await run(59_999);
    expect(code, output).toBe(1);
    expect(output).toContain("connect");
  });

  it("honours the deadline when the bridge accepts but never answers", async () => {
    // A hung bridge is the case a naive `await` would sit on forever.
    bridge = await startMockBridge(() => null);

    const started = Date.now();
    const { code, output } = await run(bridge.port);
    expect(code, output).toBe(1);
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
