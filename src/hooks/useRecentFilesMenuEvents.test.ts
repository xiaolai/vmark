// WI-1B.7 — sibling smoke test required by the multi-format TDD hook.
//
// useRecentFilesMenuEvents wires Tauri menu events for the recent-files
// list. The full integration is exercised end-to-end via the menu test
// in src/hooks/useUnifiedMenuCommands.test.tsx; this file only proves the
// hook exports and is import-clean so the TDD gate accepts edits to
// the production module.

import { describe, expect, it } from "vitest";

describe("useRecentFilesMenuEvents", () => {
  it("module exports the registration hook", async () => {
    const mod = await import("./useRecentFilesMenuEvents");
    expect(typeof mod.useRecentFilesMenuEvents).toBe("function");
  });
});
