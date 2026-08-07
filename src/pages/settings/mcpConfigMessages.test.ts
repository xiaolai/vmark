// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  diagnosticMessage,
  formatPath,
  rowActions,
  uninstallMessage,
  installMessage,
  type ProviderDiagnostic,
} from "./mcpConfigMessages";

/** Echoes the key and its interpolation values, so assertions can see both. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key) as unknown as TFunction<"settings">;

function diagnostic(over: Partial<ProviderDiagnostic> = {}): ProviderDiagnostic {
  return {
    provider: "claude",
    name: "Claude Code",
    legacy: false,
    configPath: "/Users/someone/.claude.json",
    configExists: true,
    hasVmark: false,
    expectedBinaryPath: null,
    configuredBinaryPath: null,
    binaryExists: false,
    status: "NotConfigured",
    message: "",
    ...over,
  };
}

describe("rowActions", () => {
  it("offers Install when the provider simply has no vmark entry", () => {
    expect(rowActions(diagnostic({ status: "NotConfigured" }))).toEqual({
      repair: false,
      update: false,
      remove: false,
      install: true,
      recheck: false,
    });
  });

  it("offers Update and Remove for a healthy install", () => {
    expect(rowActions(diagnostic({ status: "Valid", hasVmark: true }))).toEqual({
      repair: false,
      update: true,
      remove: true,
      install: false,
      recheck: false,
    });
  });

  it("offers Repair alongside Update and Remove on a stale binary path", () => {
    expect(rowActions(diagnostic({ status: "PathMismatch", hasVmark: true }))).toEqual({
      repair: true,
      update: true,
      remove: true,
      install: false,
      recheck: false,
    });
  });

  it("offers no config-writing action at all on a config it cannot parse", () => {
    // `hasVmark` is false here because it is UNKNOWN, not because the entry is
    // absent. Treating that as "not installed" put an Install button on a file
    // the install path now (correctly) refuses to touch.
    expect(rowActions(diagnostic({ status: "ConfigUnreadable" }))).toEqual({
      repair: false,
      update: false,
      remove: false,
      install: false,
      recheck: true,
    });
  });

  it("still hides Install on an unreadable config that happens to report hasVmark", () => {
    expect(rowActions(diagnostic({ status: "ConfigUnreadable", hasVmark: true }))).toMatchObject({
      install: false,
      update: false,
      remove: false,
    });
  });

  it("offers only Remove on a legacy provider, whatever its status", () => {
    // A legacy row exists only because a vmark entry is still in the config
    // of a discontinued tool; writing a fresh entry there is refused backend-side.
    for (const status of ["Valid", "BinaryMissing", "PathMismatch"] as const) {
      expect(rowActions(diagnostic({ status, hasVmark: true, legacy: true }))).toEqual({
        repair: false,
        update: false,
        remove: true,
        install: false,
        recheck: false,
      });
    }
  });
});

describe("diagnosticMessage", () => {
  it("says nothing for a healthy or an un-installed provider", () => {
    expect(diagnosticMessage(diagnostic({ status: "Valid", hasVmark: true }), t)).toBe("");
    expect(diagnosticMessage(diagnostic({ status: "NotConfigured" }), t)).toBe("");
  });

  it("names the binary and the repair action for the two binary faults", () => {
    expect(diagnosticMessage(diagnostic({ status: "BinaryMissing" }), t)).toBe(
      "integrations.installMcp.statusBinaryMissing",
    );
    expect(diagnosticMessage(diagnostic({ status: "PathMismatch" }), t)).toBe(
      "integrations.installMcp.statusPathMismatch",
    );
  });

  it("tells the user the file is broken, where it is, and why", () => {
    const text = diagnosticMessage(
      diagnostic({
        status: "ConfigUnreadable",
        message: "Invalid JSON: expected `,` at line 4 column 3",
      }),
      t,
    );
    expect(text).toContain("integrations.installMcp.statusConfigUnreadable");
    expect(text).toContain("~/.claude.json");
    expect(text).toContain("Invalid JSON");
  });

  it("falls back to the backend prose for a status it does not know", () => {
    const unknown = diagnostic({
      status: "SomethingNew" as ProviderDiagnostic["status"],
      message: "backend says so",
    });
    expect(diagnosticMessage(unknown, t)).toBe("backend says so");
  });

  it("explains a legacy row regardless of its status", () => {
    for (const status of ["Valid", "BinaryMissing", "PathMismatch"] as const) {
      expect(diagnosticMessage(diagnostic({ status, legacy: true }), t)).toBe(
        "integrations.installMcp.legacyHint",
      );
    }
  });
});

describe("formatPath", () => {
  it("collapses the home directory on macOS, Windows and Linux layouts", () => {
    expect(formatPath("/Users/someone/.claude.json")).toBe("~/.claude.json");
    expect(formatPath("C:\\Users\\someone\\.claude.json")).toBe("~/.claude.json");
    expect(formatPath("/home/someone/.claude.json")).toBe("~/.claude.json");
  });

  it("leaves a path outside any home directory alone", () => {
    expect(formatPath("/etc/vmark/config.json")).toBe("/etc/vmark/config.json");
  });
});

describe("install and uninstall outcomes", () => {
  it("distinguishes a removal from there having been nothing to remove", () => {
    expect(uninstallMessage(true, t)).toBe("integrations.installMcp.removeSuccess");
    expect(uninstallMessage(false, t)).toBe("integrations.installMcp.removeNothingToDo");
  });

  it("names the provider it installed for", () => {
    expect(installMessage("codex", t)).toContain("codex");
  });
});
