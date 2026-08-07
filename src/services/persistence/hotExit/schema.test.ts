// @vitest-environment node
// WI-3 — Zod at the hot-exit/session-state read boundary: pure salvage parser.
// Posture per decision ledger D5 (.claude/tdd-guardian/decisions-20260803.md):
// persistence reads are PASSTHROUGH (unknown fields survive; corrupt ≠ unknown),
// salvage valid entries per-item, quarantine (never delete) what fails parsing.
import { describe, expect, it } from "vitest";
import { salvageSessionPayload } from "./sessionSalvage";
import { quarantineArtifactName } from "./sessionQuarantine";
import type { SessionData } from "./types";

/** Realistic v5 fixture derived from src-tauri/src/hot_exit/session.rs serialization. */
function v5Tab(id: string, path: string, content: string) {
  return {
    id,
    file_path: path,
    title: path.split("/").pop() ?? path,
    is_pinned: false,
    document: {
      content,
      saved_content: content,
      is_dirty: false,
      is_missing: false,
      is_divergent: false,
      is_read_only: false,
      line_ending: "\n",
      cursor_info: {
        source_line: 1,
        word_at_cursor: "Notes",
        offset_in_word: 0,
        node_type: "heading",
        percent_in_line: 0.2,
        context_before: "# ",
        context_after: "\n",
      },
      last_modified_timestamp: 1754190000,
      is_untitled: false,
      untitled_number: null,
      undo_history: [
        { markdown: "# Notes\n", mode: "wysiwyg", cursor_info: null, timestamp: 1754195000 },
      ],
      redo_history: [],
      mode: "wysiwyg",
      hard_break_style: "unknown",
      last_disk_content: content,
    },
    format_id: "markdown",
    editing_enabled: true,
    active_schema_id: null,
  };
}

function v5Session() {
  return {
    version: 5,
    timestamp: 1754200000,
    vmark_version: "0.9.26",
    windows: [
      {
        window_label: "main",
        is_main_window: true,
        active_tab_id: "tab-1",
        tabs: [v5Tab("tab-1", "/repo-a/notes.md", "# Notes\n\nHello.\n")],
        ui_state: {
          sidebar_visible: true,
          sidebar_width: 260,
          outline_visible: false,
          sidebar_view_mode: "files",
          status_bar_visible: true,
          source_mode_enabled: false,
          focus_mode_enabled: false,
          typewriter_mode_enabled: false,
        },
        geometry: { x: 0, y: 0, width: 1440, height: 900 },
        workspace_instance_ids: ["wsi-a"],
        active_workspace_instance_id: "wsi-a",
        workspace_instances: [
          {
            workspaceInstanceId: "wsi-a",
            kind: "workspace",
            rootId: "root-a",
            rootPath: "/repo-a",
            displayName: "repo-a",
            ownerWindowLabel: "main",
            createdFrom: "open",
            activeTabId: "tab-1",
            tabIds: ["tab-1"],
            closedTabIds: [],
            unavailableRoot: false,
          },
        ],
        ui_state_by_instance: {
          "wsi-a": {
            sidebarWidth: 240,
            sidebarViewMode: "files",
            fileExplorerOpenState: { "/repo-a/docs": true },
            fileTreeScrollOffset: 0,
            outlineByTabId: {},
          },
        },
        closed_tab_scopes: { "wsi-a": [] },
      },
    ],
    workspace: { root_path: "/repo-a", is_workspace_mode: true, show_hidden_files: false },
  };
}

describe("salvageSessionPayload — valid payloads (case 1, case 7)", () => {
  it("returns a valid full payload untouched (identity, no narrowing)", () => {
    const fixture = v5Session();
    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    // Identity: the exact object goes through — schema validates, never rewrites.
    expect(result.session).toBe(fixture);
    expect(result.quarantined).toEqual([]);
    expect(result.session).toEqual(v5Session());
  });

  it("round-trips CJK paths and content byte-identically (case 7)", () => {
    const fixture = v5Session();
    fixture.windows[0].tabs = [v5Tab("tab-cjk", "路径/未命名.md", "# 标题\n\n中文内容，混排 English。\n")];
    fixture.windows[0].active_tab_id = "tab-cjk";
    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(JSON.stringify(result.session)).toBe(JSON.stringify(fixture));
    const tab = (result.session as ReturnType<typeof v5Session>).windows[0].tabs[0];
    expect(tab.file_path).toBe("路径/未命名.md");
    expect(tab.document.content).toBe("# 标题\n\n中文内容，混排 English。\n");
  });

  it("tolerates a legacy v1 shape (windows without ui_state/geometry, tabs without v3 fields)", () => {
    // Migration runs AFTER the boundary; the schema must not quarantine old-but-valid data.
    const v1 = {
      version: 1,
      timestamp: 1700000000,
      vmark_version: "0.3.24",
      windows: [
        {
          window_label: "main",
          is_main_window: true,
          tabs: [
            {
              id: "t1",
              file_path: "/old.md",
              title: "old.md",
              is_pinned: false,
              document: {
                content: "old",
                saved_content: "old",
                is_dirty: false,
                is_missing: false,
                is_divergent: false,
                line_ending: "\n",
                cursor_info: null,
                last_modified_timestamp: null,
                is_untitled: false,
                untitled_number: null,
              },
            },
          ],
        },
      ],
      workspace: null,
    };
    const result = salvageSessionPayload(v1);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.session).toBe(v1 as unknown as SessionData);
    expect(result.quarantined).toEqual([]);
  });
});

describe("salvageSessionPayload — passthrough (case 5)", () => {
  it("keeps unknown extra fields at every nesting level through the boundary", () => {
    const fixture = v5Session() as Record<string, unknown>;
    fixture.futureField = "envelope";
    const win = (fixture.windows as Record<string, unknown>[])[0];
    win.futureField = "window";
    const tab = (win.tabs as Record<string, unknown>[])[0];
    tab.futureField = "tab";
    (tab.document as Record<string, unknown>).futureField = "document";
    (fixture.workspace as Record<string, unknown>).futureField = "workspace";

    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    const roundTripped = JSON.parse(JSON.stringify(result.session));
    expect(roundTripped.futureField).toBe("envelope");
    expect(roundTripped.windows[0].futureField).toBe("window");
    expect(roundTripped.windows[0].tabs[0].futureField).toBe("tab");
    expect(roundTripped.windows[0].tabs[0].document.futureField).toBe("document");
    expect(roundTripped.workspace.futureField).toBe("workspace");
  });
});

describe("salvageSessionPayload — empty is not corrupt (case 4)", () => {
  it.each([
    { name: "null", raw: null },
    { name: "undefined", raw: undefined },
    { name: "empty object", raw: {} },
  ])("$name → clean empty result with nothing quarantined", ({ raw }) => {
    expect(salvageSessionPayload(raw)).toEqual({ status: "empty" });
  });
});

describe("salvageSessionPayload — per-item salvage (cases 3, 6)", () => {
  it("keeps valid tabs and quarantines the one missing a required field (case 3)", () => {
    const fixture = v5Session();
    const good1 = v5Tab("tab-1", "/a.md", "A");
    const bad = { id: "tab-2", title: "no document" }; // document missing
    const good3 = v5Tab("tab-3", "/c.md", "C");
    fixture.windows[0].tabs = [good1, bad as never, good3];

    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    const tabs = (result.session as ReturnType<typeof v5Session>).windows[0].tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toBe(good1);
    expect(tabs[1]).toBe(good3);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].raw).toBe(bad);
    expect(result.quarantined[0].path).toBe("windows[0].tabs[1]");
  });

  it("quarantines a wrong-typed tab id and keeps siblings (case 6)", () => {
    const fixture = v5Session();
    const good = v5Tab("tab-1", "/a.md", "A");
    const bad = { ...v5Tab("tab-2", "/b.md", "B"), id: 42 };
    fixture.windows[0].tabs = [good, bad as never];

    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect((result.session as ReturnType<typeof v5Session>).windows[0].tabs).toEqual([good]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].raw).toBe(bad);
  });

  it("quarantines an unusable window and keeps the valid one", () => {
    const fixture = v5Session() as { windows: unknown[] };
    const goodWindow = (fixture.windows as unknown[])[0];
    fixture.windows = [goodWindow, "not a window"];

    const result = salvageSessionPayload(fixture);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect((result.session as { windows: unknown[] }).windows).toEqual([goodWindow]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].raw).toBe("not a window");
    expect(result.quarantined[0].path).toBe("windows[1]");
  });
});

describe("salvageSessionPayload — unusable payloads are quarantined, never thrown", () => {
  it.each([
    { name: "truncated-JSON remnant delivered as a string", raw: '{"tabs":[{"id":' },
    { name: "wrong-typed version", raw: { ...v5Session(), version: "5" } },
    { name: "windows is not an array", raw: { ...v5Session(), windows: "garbage" } },
    { name: "array payload", raw: [1, 2, 3] },
  ])("$name → status invalid with the exact payload quarantined", ({ raw }) => {
    const result = salvageSessionPayload(raw);
    if (result.status !== "invalid") throw new Error(`expected invalid, got ${result.status}`);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].raw).toBe(raw);
    expect(result.quarantined[0].path).toBe("$");
    expect(result.quarantined[0].reason).toBeTruthy();
  });

  it("treats a non-empty windows array with zero survivors as invalid (nothing restorable)", () => {
    const raw = { ...v5Session(), windows: [null, 7] };
    const result = salvageSessionPayload(raw);
    expect(result.status).toBe("invalid");
  });
});

describe("quarantineArtifactName — deterministic (case 8 mechanism)", () => {
  it("is stable for identical entries and distinct for different entries", async () => {
    const a = [{ path: "$", raw: '{"tabs":[{"id":', reason: "invalid envelope" }];
    const b = [{ path: "$", raw: { version: "5" }, reason: "invalid envelope" }];
    await expect(quarantineArtifactName(a)).resolves.toBe(
      await quarantineArtifactName(a.map((e) => ({ ...e }))),
    );
    await expect(quarantineArtifactName(a)).resolves.not.toBe(
      await quarantineArtifactName(b),
    );
    await expect(quarantineArtifactName(a)).resolves.toMatch(
      /^session\.corrupt-[0-9a-f]+\.json$/,
    );
  });

  // Audit 20260804-F13: the name used to be a 32-bit FNV-1a hex, an 8-hex-digit
  // space. Quarantine's contract is "a DIFFERENT corruption gets a different
  // name, so an earlier artifact is never overwritten" — at 32 bits that is a
  // ~50% chance of collision by ~77k artifacts and a real chance well before,
  // and a collision means silently destroying the corrupt payload the feature
  // exists to preserve. SHA-256, truncated to 16 hex digits (64 bits).
  it("uses a 64-bit hex prefix, not a 32-bit one", async () => {
    const name = await quarantineArtifactName([
      { path: "$", raw: "x", reason: "r" },
    ]);
    expect(name).toMatch(/^session\.corrupt-[0-9a-f]{16}\.json$/);
  });

  it("matches a known SHA-256 prefix — the digest, not just some digest", async () => {
    const entries = [{ path: "$", raw: "x", reason: "r" }];
    const serialized = JSON.stringify(
      { entries: entries.map((e) => ({ path: e.path, reason: e.reason, payload: e.raw })) },
      null,
      2,
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    const expected = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    await expect(quarantineArtifactName(entries)).resolves.toBe(
      `session.corrupt-${expected}.json`,
    );
  });

  it("gives different names to payloads that differ only far into the string", async () => {
    // The failure mode a short non-cryptographic hash makes plausible: two
    // large, nearly-identical corrupt payloads sharing one artifact file.
    const base = "y".repeat(4096);
    const a = [{ path: "$", raw: `${base}a`, reason: "r" }];
    const b = [{ path: "$", raw: `${base}b`, reason: "r" }];

    await expect(quarantineArtifactName(a)).resolves.not.toBe(
      await quarantineArtifactName(b),
    );
  });

  it("is order-sensitive across entries, so two different sets cannot share a file", async () => {
    const one = { path: "windows[0]", raw: 1, reason: "r" };
    const two = { path: "windows[1]", raw: 2, reason: "r" };

    await expect(quarantineArtifactName([one, two])).resolves.not.toBe(
      await quarantineArtifactName([two, one]),
    );
  });
});
