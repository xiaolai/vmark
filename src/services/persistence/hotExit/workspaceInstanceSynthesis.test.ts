import { describe, expect, it } from "vitest";
import type { TabState } from "./types";
import {
  synthesizeLegacyWindowInstances,
  type LegacyWindowSynthesisInput,
} from "./workspaceInstanceSynthesis";

function tab(id: string, filePath: string | null): TabState {
  return {
    id,
    file_path: filePath,
    title: id,
    is_pinned: false,
    format_id: "markdown",
    editing_enabled: true,
    active_schema_id: null,
    document: {
      content: "content",
      saved_content: "content",
      is_dirty: false,
      is_missing: false,
      is_divergent: false,
      line_ending: "\n",
      cursor_info: null,
      last_modified_timestamp: null,
      is_untitled: filePath === null,
      untitled_number: filePath === null ? 1 : null,
      undo_history: [],
      redo_history: [],
    },
  };
}

function window(overrides: Partial<LegacyWindowSynthesisInput> = {}): LegacyWindowSynthesisInput {
  return { windowLabel: "main", activeTabId: null, tabs: [], ...overrides };
}

describe("synthesizeLegacyWindowInstances", () => {
  it("returns no records when the window has no tabs", () => {
    expect(synthesizeLegacyWindowInstances(window(), "/repo")).toEqual([]);
  });

  it("splits tabs into workspace and loose contexts by root membership", () => {
    const synthesized = synthesizeLegacyWindowInstances(
      window({
        activeTabId: "outside",
        tabs: [tab("inside", "/repo/a.md"), tab("outside", "/other/b.md"), tab("untitled", null)],
      }),
      "/repo",
    );

    expect(synthesized).toMatchObject([
      { kind: "workspace", rootPath: "/repo", tabIds: ["inside"], activeTabId: null },
      { kind: "loose", rootPath: null, tabIds: ["outside", "untitled"], activeTabId: "outside" },
    ]);
  });

  it("preserves workspace tabs with a fallback identity when the root is unusable", () => {
    // Regression for the divergence where restore dropped these tabs while
    // migration kept them. A blank root path makes createWorkspaceRootIdentity
    // fail, but the tabs must still survive as a workspace context.
    const synthesized = synthesizeLegacyWindowInstances(
      window({ activeTabId: "space-path", tabs: [tab("space-path", "   /a.md")] }),
      "   ",
    );

    expect(synthesized).toMatchObject([
      {
        kind: "workspace",
        rootId: "path:macos:   ",
        rootPath: "   ",
        displayName: "   ",
        tabIds: ["space-path"],
        activeTabId: "space-path",
      },
    ]);
  });

  it("treats all tabs as loose when no legacy workspace root is given", () => {
    expect(
      synthesizeLegacyWindowInstances(
        window({ tabs: [tab("a", "/x/a.md"), tab("b", null)] }),
        null,
      ),
    ).toMatchObject([
      { kind: "loose", tabIds: ["a", "b"] },
    ]);
  });
});
