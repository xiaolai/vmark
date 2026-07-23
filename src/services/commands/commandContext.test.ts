/**
 * Command-context resolver tests — command-registry WI-2.1 (Phase 2).
 *
 * @module services/commands/commandContext.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";

const ui = vi.hoisted(() => ({ sourceMode: false }));
const lfs = vi.hoisted(() => ({ forced: new Set<string>() }));
const ed = vi.hoisted(() => ({
  wysiwyg: null as { view: object } | null,
  source: null as object | null,
  tiptapContext: null as Record<string, unknown> | null,
  sourceContext: null as Record<string, unknown> | null,
}));
const ms = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/stores/uiStore", () => {
  const useUIStore = (sel?: (s: { sourceMode: boolean }) => unknown) =>
    sel ? sel({ sourceMode: ui.sourceMode }) : { sourceMode: ui.sourceMode };
  useUIStore.getState = () => ({ sourceMode: ui.sourceMode });
  return { useUIStore };
});
vi.mock("@/stores/documentStore", () => ({
  useLargeFileSessionStore: { getState: () => ({ isForcedSource: (id: string) => lfs.forced.has(id) }) },
}));
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      active: { activeWysiwygEditor: ed.wysiwyg, activeSourceView: ed.source },
      tiptap: { context: ed.tiptapContext },
      source: { context: ed.sourceContext },
    }),
  },
}));
vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: () => ({ enabled: ms.enabled }),
  getSourceMultiSelectionContext: () => ({ enabled: ms.enabled }),
}));

import { resolveCommandContext } from "./commandContext";

const VIEW = {} as object;

function docTab(id: string, formatId = "markdown"): Tab {
  return { id, title: id, kind: "document", filePath: `/${id}.md`, formatId } as unknown as Tab;
}

beforeEach(() => {
  ui.sourceMode = false;
  lfs.forced.clear();
  ed.wysiwyg = { view: VIEW };
  ed.source = VIEW;
  ed.tiptapContext = null;
  ed.sourceContext = null;
  ms.enabled = false;
  useTabStore.setState({ tabs: { main: [docTab("t1")] }, activeTabId: { main: "t1" } });
});

describe("resolveCommandContext", () => {
  it("reports a live document tab + its format", () => {
    const c = resolveCommandContext("main");
    expect(c.isDocument).toBe(true);
    expect(c.formatId).toBe("markdown");
    expect(c.mode).toBe("wysiwyg");
    expect(c.editorAvailable).toBe(true);
  });

  it("is not a document when the active tab is a browser tab", () => {
    useTabStore.setState({
      tabs: { main: [{ id: "b", title: "b", kind: "browser" } as unknown as Tab] },
      activeTabId: { main: "b" },
    });
    const c = resolveCommandContext("main");
    expect(c.isDocument).toBe(false);
    expect(c.formatId).toBeNull();
  });

  it("is not a document when there is no active tab", () => {
    useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
    expect(resolveCommandContext("main").isDocument).toBe(false);
  });

  it("resolves source mode from the UI store", () => {
    ui.sourceMode = true;
    expect(resolveCommandContext("main").mode).toBe("source");
  });

  it("resolves forced-source even when the window is WYSIWYG", () => {
    ui.sourceMode = false;
    lfs.forced.add("t1");
    expect(resolveCommandContext("main").mode).toBe("source");
  });

  it("editorAvailable follows the effective surface's editor", () => {
    ed.wysiwyg = null;
    expect(resolveCommandContext("main").editorAvailable).toBe(false);
    ui.sourceMode = true;
    ed.source = null;
    expect(resolveCommandContext("main").editorAvailable).toBe(false);
  });

  it("normalises the WYSIWYG cursor context (optional-truthy shape) to booleans", () => {
    ed.tiptapContext = { hasSelection: true, inTable: { row: 0 }, inLink: { href: "x" } };
    const c = resolveCommandContext("main");
    expect(c.hasSelection).toBe(true);
    expect(c.inTable).toBe(true);
    expect(c.inLink).toBe(true);
    expect(c.inList).toBe(false);
  });

  it("normalises the Source cursor context (nullable shape) to booleans", () => {
    ui.sourceMode = true;
    ed.sourceContext = { hasSelection: false, inTable: { nodePos: 1 }, inLink: null, inList: { depth: 1 } };
    const c = resolveCommandContext("main");
    expect(c.hasSelection).toBe(false);
    expect(c.inTable).toBe(true);
    expect(c.inLink).toBe(false);
    expect(c.inList).toBe(true);
  });

  it("reports multiSelection from the helper", () => {
    ms.enabled = true;
    expect(resolveCommandContext("main").multiSelection).toBe(true);
  });
});
