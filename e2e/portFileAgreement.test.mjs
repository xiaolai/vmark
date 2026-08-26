// The E2E harness and the shipping sidecar must agree on where VMark publishes
// its bridge port.
//
// Both derive `<app data dir>/mcp-port` from the bundle identifier, and they do
// it in two separate implementations: `server/mcp/src/utils/portFile.ts` ships
// inside the app, and `e2e/lib/vmarkMcp.mjs` cannot import it (different
// package, different build, and the harness runs before the sidecar is built).
//
// They are not merged, deliberately. Importing compiled sidecar output would
// make the harness depend on a build artifact it also rebuilds, and vendoring
// the harness copy into the sidecar would ship test code. What is NOT
// acceptable is letting them drift silently, because the symptom is maximally
// misleading: the harness looks in the wrong directory, finds no port file, and
// reports "the app never became drivable" — sending you to debug an app that
// started perfectly.
//
// So the duplication stays and the AGREEMENT is asserted. Drift fails here, in
// milliseconds, with both paths printed.

import { describe, it, expect } from "vitest";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const RELEASE_ID = "app.vmark";

/** The path `e2e/lib/vmarkMcp.mjs` computes, re-derived from its own source. */
function harnessPath(identifier) {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", identifier, "mcp-port");
  }
  if (platform() === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      identifier,
      "mcp-port",
    );
  }
  return join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    identifier,
    "mcp-port",
  );
}

describe("port-file path agreement", () => {
  it("resolves the same path as the shipping sidecar", async () => {
    // Imported with the RELEASE identifier, which is what the sidecar ships
    // with; the harness overrides it per run via VMARK_APP_IDENTIFIER.
    delete process.env.VMARK_APP_IDENTIFIER;
    const { getPortFilePath } = await import("../server/mcp/src/utils/portFile.ts");
    expect(getPortFilePath()).toBe(harnessPath(RELEASE_ID));
  });

  it("keeps the harness copy structurally identical to the sidecar's", () => {
    // The re-derivation above is only meaningful if it still matches what the
    // harness actually does. These are the three branches both must have.
    const harness = readFileSync("e2e/lib/vmarkMcp.mjs", "utf8");
    for (const marker of [
      '"Library", "Application Support"',
      "APPDATA",
      "XDG_DATA_HOME",
    ]) {
      expect(harness, `harness lost the ${marker} branch`).toContain(marker);
    }
    expect(harness).toContain('"mcp-port"');
  });

  it("has the sidecar default to the RELEASE identifier", () => {
    // The harness points itself at the dev profile; the sidecar must not, or a
    // shipped app would look for a port file no release ever writes.
    const sidecar = readFileSync("server/mcp/src/utils/portFile.ts", "utf8");
    expect(sidecar).toContain(`|| '${RELEASE_ID}'`);
  });
});
