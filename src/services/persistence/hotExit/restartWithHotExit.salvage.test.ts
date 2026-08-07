// @vitest-environment node
// WI-3 — corrupt-session flow tests for checkAndRestoreSession: restore never
// throws, never silently discards the session file, quarantines what fails
// parsing (preserve, never delete), and is idempotent on re-run (matrix cases
// 2, 4, 8 + partial salvage). Mock boundary: @tauri-apps/* ONLY, via a
// STATEFUL fake fs (write→read returns written bytes; no silent-success).
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { checkAndRestoreSession } from "./restartWithHotExit";
import { HOT_EXIT_EVENTS } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
// Internal restore composition is exercised by useHotExitRestore tests; here it
// must only not reject (not a store, so mocking it is within the WI-18 policy).
vi.mock("../resilience/_hotExitRestore", () => ({
  restoreMainWindowState: vi.fn().mockResolvedValue(undefined),
}));

/** Path constants matching the global @tauri-apps/api/path mock in setup.ts. */
const APP_DATA = "/Users/test/.config";
const SESSION_PATH = `${APP_DATA}/session.json`;

/** Stateful fake fs: the single source of truth for persisted bytes. */
const fakeFs = new Map<string, string>();

function artifactPaths(): string[] {
  return [...fakeFs.keys()].filter((p) => p !== SESSION_PATH).sort();
}

/**
 * Faithful model of the Rust side (storage.rs): inspect parses the session
 * file; unparseable bytes fall back to "no session" WITHOUT deleting the file;
 * clear_session deletes it; restore commands succeed. Unknown commands reject
 * loudly — no silent-success defaults.
 */
function installStatefulInvoke(): void {
  (invoke as Mock).mockImplementation((cmd: string) => {
    switch (cmd) {
      case "hot_exit_inspect_session": {
        const text = fakeFs.get(SESSION_PATH);
        if (text === undefined) return Promise.resolve(null);
        try {
          return Promise.resolve(JSON.parse(text));
        } catch {
          return Promise.resolve(null); // corrupt file: Rust keeps it and reports none
        }
      }
      case "hot_exit_clear_session":
        fakeFs.delete(SESSION_PATH);
        return Promise.resolve();
      case "hot_exit_restore":
      case "hot_exit_restore_multi_window":
        return Promise.resolve({ windows_created: [] });
      default:
        return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    }
  });
}

function validTab(id: string) {
  return {
    id,
    file_path: `/repo/${id}.md`,
    title: `${id}.md`,
    is_pinned: false,
    document: {
      content: `# ${id}\n`,
      saved_content: `# ${id}\n`,
      is_dirty: false,
      is_missing: false,
      is_divergent: false,
      line_ending: "\n",
      cursor_info: null,
      last_modified_timestamp: null,
      is_untitled: false,
      untitled_number: null,
      undo_history: [],
      redo_history: [],
    },
    format_id: "markdown",
    editing_enabled: true,
    active_schema_id: null,
  };
}

function sessionWithTabs(tabs: unknown[]): Record<string, unknown> {
  return {
    version: 5,
    timestamp: 1754200000,
    vmark_version: "0.9.26",
    windows: [
      { window_label: "main", is_main_window: true, active_tab_id: null, tabs },
    ],
    workspace: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeFs.clear();
  installStatefulInvoke();
  (listen as Mock).mockImplementation(() => Promise.resolve(() => {}));
  (writeTextFile as Mock).mockImplementation((path: string, contents: string) => {
    fakeFs.set(path, contents);
    return Promise.resolve();
  });
});

describe("checkAndRestoreSession — corrupt payloads (WI-3)", () => {
  it("case 2a: truncated JSON bytes → clean no-restore, original file kept, no artifact", async () => {
    fakeFs.set(SESSION_PATH, '{"tabs":[{"id":');
    await expect(checkAndRestoreSession()).resolves.toBe(false);
    expect(fakeFs.get(SESSION_PATH)).toBe('{"tabs":[{"id":'); // byte-identical, not deleted
    expect(artifactPaths()).toEqual([]);
  });

  it("case 2b (RED reproducer): structurally corrupt payload → no throw, file NOT deleted, quarantine artifact holds the exact payload", async () => {
    const corrupt = JSON.stringify({ ...sessionWithTabs([validTab("t1")]), version: "5" });
    fakeFs.set(SESSION_PATH, corrupt);

    await expect(checkAndRestoreSession()).resolves.toBe(false);

    // The original session file survives byte-identically (today it is DELETED
    // via clearSessionFile('incompatible version') — the data-loss bug).
    expect(fakeFs.get(SESSION_PATH)).toBe(corrupt);
    // A quarantine artifact preserves the corrupt payload as received.
    const artifacts = artifactPaths();
    expect(artifacts).toHaveLength(1);
    const artifact = JSON.parse(fakeFs.get(artifacts[0]) as string);
    expect(artifact.entries).toHaveLength(1);
    expect(artifact.entries[0].payload).toEqual(JSON.parse(corrupt));
    // Restore was never dispatched with a corrupt session.
    const restoreCalls = (invoke as Mock).mock.calls.filter(
      (c) => c[0] === "hot_exit_restore" || c[0] === "hot_exit_restore_multi_window",
    );
    expect(restoreCalls).toEqual([]);
  });

  it("case 8: re-running on the same corrupt input is idempotent — same artifact, no duplicates", async () => {
    const corrupt = JSON.stringify({ ...sessionWithTabs([]), version: "5" });
    fakeFs.set(SESSION_PATH, corrupt);

    await expect(checkAndRestoreSession()).resolves.toBe(false);
    const firstArtifacts = artifactPaths();
    await expect(checkAndRestoreSession()).resolves.toBe(false);
    const secondArtifacts = artifactPaths();

    expect(firstArtifacts).toHaveLength(1);
    expect(secondArtifacts).toEqual(firstArtifacts); // deterministic name, count stable
    expect(fakeFs.get(SESSION_PATH)).toBe(corrupt); // still preserved after both runs
  });

  it("case 4: missing file and empty file → clean empty restore, no artifact, no clear", async () => {
    await expect(checkAndRestoreSession()).resolves.toBe(false); // missing
    fakeFs.set(SESSION_PATH, "");
    await expect(checkAndRestoreSession()).resolves.toBe(false); // empty (unparseable)
    expect(fakeFs.get(SESSION_PATH)).toBe("");
    expect(artifactPaths()).toEqual([]);
    const clearCalls = (invoke as Mock).mock.calls.filter((c) => c[0] === "hot_exit_clear_session");
    expect(clearCalls).toEqual([]);
  });

  it("partial salvage: valid tabs restored, invalid tab quarantined, session file PRESERVED", async () => {
    const bad = { id: 42, title: "corrupt tab" };
    const payload = sessionWithTabs([validTab("t1"), bad, validTab("t3")]);
    fakeFs.set(SESSION_PATH, JSON.stringify(payload));

    // Resolve the restore lifecycle: capture listeners, then emit complete.
    const listeners = new Map<string, (e: { payload: unknown }) => void>();
    (listen as Mock).mockImplementation(
      (name: string, handler: (e: { payload: unknown }) => void) => {
        listeners.set(name, handler);
        return Promise.resolve(() => listeners.delete(name));
      },
    );

    const resultPromise = checkAndRestoreSession();
    await vi.waitFor(() => {
      const calls = (invoke as Mock).mock.calls.filter((c) => c[0] === "hot_exit_restore");
      expect(calls).toHaveLength(1);
    });
    const restoreCall = (invoke as Mock).mock.calls.find((c) => c[0] === "hot_exit_restore");
    const dispatched = (restoreCall?.[1] as { session: { windows: { tabs: unknown[] }[] } }).session;
    expect(dispatched.windows[0].tabs.map((t) => (t as { id: string }).id)).toEqual(["t1", "t3"]);

    listeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE)?.({ payload: {} });
    await expect(resultPromise).resolves.toBe(true);

    // Audit 20260804-F10: the session file used to be CLEARED here. The
    // quarantine artifact is a derived copy, so deleting the original throws
    // away the only pristine evidence of a payload the frontend could not
    // fully read — for the price of one stale file the next quit overwrites.
    expect(fakeFs.get(SESSION_PATH)).toBe(JSON.stringify(payload));
    const clearCalls = (invoke as Mock).mock.calls.filter(
      (c) => c[0] === "hot_exit_clear_session",
    );
    expect(clearCalls).toEqual([]);

    const artifacts = artifactPaths();
    expect(artifacts).toHaveLength(1);
    const artifact = JSON.parse(fakeFs.get(artifacts[0]) as string);
    expect(artifact.entries[0].payload).toEqual(bad);
  });

  /**
   * Audit 20260804-F10 — the clear path is the irreversible one.
   *
   * The structural hole was upstream: `storage.rs::read_session` substituted
   * `session.prev.json` when the main file was corrupt WITHOUT telling the
   * frontend, so the salvage boundary never saw the corrupt bytes and a
   * successful restore deleted both files. The frontend half is these two
   * guards; the Rust half landed as `recovered_from_backup` on
   * `hot_exit_inspect_session` (audit 20260803 §11), so the second case below
   * is now reachable in production rather than forward-compatibility only.
   */
  describe("clear is refused when the payload was not wholly readable", () => {
    /** Drive a restore to a successful completion and return the result. */
    async function restoreToCompletion(): Promise<boolean> {
      const listeners = new Map<string, (e: { payload: unknown }) => void>();
      (listen as Mock).mockImplementation(
        (name: string, handler: (e: { payload: unknown }) => void) => {
          listeners.set(name, handler);
          return Promise.resolve(() => listeners.delete(name));
        },
      );
      const resultPromise = checkAndRestoreSession();
      await vi.waitFor(() => {
        const calls = (invoke as Mock).mock.calls.filter(
          (c) => c[0] === "hot_exit_restore" || c[0] === "hot_exit_restore_multi_window",
        );
        expect(calls.length).toBeGreaterThan(0);
      });
      listeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE)?.({ payload: {} });
      return resultPromise;
    }

    it("clears on a CLEAN payload — the guard is not a blanket refusal", async () => {
      const payload = sessionWithTabs([validTab("t1")]);
      fakeFs.set(SESSION_PATH, JSON.stringify(payload));

      await expect(restoreToCompletion()).resolves.toBe(true);

      expect(fakeFs.has(SESSION_PATH)).toBe(false);
      expect(artifactPaths()).toEqual([]);
    });

    it("preserves the session file when salvage rejected material", async () => {
      const payload = sessionWithTabs([validTab("t1"), { id: 42 }]);
      fakeFs.set(SESSION_PATH, JSON.stringify(payload));

      await expect(restoreToCompletion()).resolves.toBe(true);

      expect(fakeFs.get(SESSION_PATH)).toBe(JSON.stringify(payload));
    });

    it("preserves the session file when Rust reports a backup substitution", async () => {
      // Live path: `hot_exit_inspect_session` sets this flag whenever
      // `session.prev.json` stood in for an unusable `session.json`, and Rust
      // deliberately leaves the corrupt main file on disk. Clearing here would
      // destroy the only evidence of the failure.
      const payload = { ...sessionWithTabs([validTab("t1")]), recovered_from_backup: true };
      fakeFs.set(SESSION_PATH, JSON.stringify(payload));

      await expect(restoreToCompletion()).resolves.toBe(true);

      expect(fakeFs.get(SESSION_PATH)).toBe(JSON.stringify(payload));
      const clearCalls = (invoke as Mock).mock.calls.filter(
        (c) => c[0] === "hot_exit_clear_session",
      );
      expect(clearCalls).toEqual([]);
    });

    it("still clears when the flag is present but false", async () => {
      const payload = { ...sessionWithTabs([validTab("t1")]), recovered_from_backup: false };
      fakeFs.set(SESSION_PATH, JSON.stringify(payload));

      await expect(restoreToCompletion()).resolves.toBe(true);

      expect(fakeFs.has(SESSION_PATH)).toBe(false);
    });
  });

  it("failure path: quarantine write fails → restore aborts and the session file is preserved", async () => {
    (writeTextFile as Mock).mockImplementation(() => Promise.reject(new Error("disk full")));
    const corrupt = JSON.stringify({ ...sessionWithTabs([validTab("t1")]), version: "5" });
    fakeFs.set(SESSION_PATH, corrupt);

    await expect(checkAndRestoreSession()).resolves.toBe(false);
    expect(fakeFs.get(SESSION_PATH)).toBe(corrupt); // never deleted
    const restoreCalls = (invoke as Mock).mock.calls.filter(
      (c) => c[0] === "hot_exit_restore" || c[0] === "hot_exit_restore_multi_window",
    );
    expect(restoreCalls).toEqual([]);
  });
});
