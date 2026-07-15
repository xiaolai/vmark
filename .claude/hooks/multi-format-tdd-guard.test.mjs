// Regression suite for the multi-format TDD guard (multi-format-tdd-guard.mjs).
//
// Two 2026-07 refactors relocated four scoped frontend files and decomposed
// window_manager.rs into a module tree. The guard silently stopped enforcing
// the moved code (edits exited 0). These tests pin the CURRENT scope so a
// future move surfaces as a red test instead of a silent bypass, and cover
// fail-closed input handling plus the Rust inline/sibling-test policy.
//
// Exit codes: 0 allow · 2 block.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Vitest runs with cwd = repo root; import.meta.url is a virtual URL under the
// jsdom transform, so anchor on cwd instead.
const GUARD = join(process.cwd(), ".claude/hooks/multi-format-tdd-guard.mjs");

function runGuard(payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = spawnSync(process.execPath, [GUARD], { input, encoding: "utf8" });
  return { status: res.status, stderr: res.stderr ?? "" };
}

const write = (file_path) => ({ tool_name: "Write", tool_input: { file_path } });

describe("multi-format-tdd-guard — fail closed on unusable input", () => {
  it("blocks on malformed JSON", () => {
    expect(runGuard("nope{").status).toBe(2);
  });

  it("blocks on a non-object payload", () => {
    expect(runGuard('"a string"').status).toBe(2);
  });

  it("allows non-mutation tools", () => {
    expect(runGuard({ tool_name: "Read", tool_input: { file_path: "src/stores/tabStore.ts" } }).status).toBe(0);
  });
});

describe("multi-format-tdd-guard — frontend scope tracks the relocated paths", () => {
  it("blocks the CURRENT contentSearchSlice location (no test yet)", () => {
    // Moved from src/stores/contentSearchStore.ts; now scoped here.
    expect(runGuard(write("src/stores/uiStore/contentSearchSlice.ts")).status).toBe(2);
  });

  it("no longer scopes the DELETED original paths", () => {
    // These files are gone; matching them would be enforcing nothing.
    for (const stale of [
      "src/stores/contentSearchStore.ts",
      "src/utils/newFile.ts",
      "src/utils/macQuarantineNotice.ts",
      "src/hooks/useRecentFilesMenuEvents.ts",
      "src/utils/yamlOpenRouting.ts",
    ]) {
      expect(runGuard(write(stale)).status, `${stale} should be out of scope now`).toBe(0);
    }
  });

  it("allows relocated files that already have sibling tests", () => {
    // services/navigation/newFile.ts + services/macos/macQuarantineNotice.ts
    // ship with .test.ts; useRecentFilesSync.ts too.
    for (const moved of [
      "src/services/navigation/newFile.ts",
      "src/services/macos/macQuarantineNotice.ts",
      "src/hooks/useRecentFilesSync.ts",
    ]) {
      expect(runGuard(write(moved)).status, `${moved} has a test → allowed`).toBe(0);
    }
  });

  it("still blocks an untested file inside a scoped glob", () => {
    expect(runGuard(write("src/lib/formats/__no_test__.ts")).status).toBe(2);
  });

  it("honors the allow-list (types.ts, .d.ts)", () => {
    expect(runGuard(write("src/lib/formats/types.ts")).status).toBe(0);
    expect(runGuard(write("src/lib/formats/shims.d.ts")).status).toBe(0);
  });
});

describe("multi-format-tdd-guard — Rust scope tracks the decomposed module", () => {
  it("no longer scopes the deleted window_manager.rs monolith", () => {
    expect(runGuard(write("src-tauri/src/window_manager.rs")).status).toBe(0);
  });

  it("blocks an untested submodule (window_manager/commands.rs)", () => {
    // commands.rs has neither an inline #[cfg(test)] nor a sibling commands.test.rs.
    expect(runGuard(write("src-tauri/src/window_manager/commands.rs")).status).toBe(2);
  });

  it("allows a submodule that has a sibling .test.rs", () => {
    // path_validation.rs ships path_validation.test.rs.
    expect(runGuard(write("src-tauri/src/window_manager/path_validation.rs")).status).toBe(0);
  });
});
