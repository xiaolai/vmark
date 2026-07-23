/**
 * Executor tests — command-registry WI-1.1..1.5 (Phase 1).
 *
 * Covers the shared executor's contract: parity with the menu's execution
 * semantics (unified undo/redo, heading params, forced-source resolution),
 * the execution-time format + capability gates, and the three cross-model
 * hardenings — capture-before-dispatch + IME-deferred ownership revalidation,
 * and the per-window retry owner. These ownership/isolation assertions would
 * fail against the pre-extraction menu hook (which had no ownership check in
 * the IME-queued callback and used a single module-global timer set).
 *
 * @module services/editor/runEditorAction.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ActionId } from "@/plugins/actions/types";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";

const ime = vi.hoisted(() => ({
  pmComposing: false,
  cmComposing: false,
  pmQueue: [] as Array<() => void>,
  cmQueue: [] as Array<() => void>,
}));
const ui = vi.hoisted(() => ({ sourceMode: false }));
const lfs = vi.hoisted(() => ({ forced: new Set<string>() }));
const fmt = vi.hoisted(() => ({
  policy: { paragraphFormatting: true, insertBlockActions: true, cjkFormatActions: true },
}));
const editors = vi.hoisted(() => ({
  wysiwyg: null as { view: object } | null,
  source: null as object | null,
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: (_v: unknown, fn: () => void) => {
    if (ime.pmComposing) ime.pmQueue.push(fn);
    else fn();
  },
  runOrQueueCodeMirrorAction: (_v: unknown, fn: () => void) => {
    if (ime.cmComposing) ime.cmQueue.push(fn);
    else fn();
  },
}));

vi.mock("@/stores/uiStore", () => {
  const useUIStore = (sel?: (s: { sourceMode: boolean }) => unknown) =>
    sel ? sel({ sourceMode: ui.sourceMode }) : { sourceMode: ui.sourceMode };
  useUIStore.getState = () => ({ sourceMode: ui.sourceMode });
  return { useUIStore };
});

vi.mock("@/stores/documentStore", () => ({
  useLargeFileSessionStore: {
    getState: () => ({ isForcedSource: (id: string) => lfs.forced.has(id) }),
  },
}));

vi.mock("@/lib/formats/registry", () => ({
  getFormatById: () => ({ adapters: { menuPolicy: fmt.policy } }),
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      active: { activeWysiwygEditor: editors.wysiwyg, activeSourceView: editors.source },
      source: { context: null },
    }),
  },
}));

vi.mock("@/plugins/actions/actionRegistry", () => ({
  ACTION_DEFINITIONS: {
    bold: { id: "bold", label: "Bold", category: "formatting", supports: { wysiwyg: true, source: true } },
    undo: { id: "undo", label: "Undo", category: "edit", supports: { wysiwyg: true, source: true } },
    redo: { id: "redo", label: "Redo", category: "edit", supports: { wysiwyg: true, source: true } },
    setHeading: { id: "setHeading", label: "Heading", category: "headings", supports: { wysiwyg: true, source: true } },
    paragraph: { id: "paragraph", label: "Paragraph", category: "formatting", supports: { wysiwyg: true, source: true } },
    wysiwygOnly: { id: "wysiwygOnly", label: "W", category: "formatting", supports: { wysiwyg: true, source: false } },
    sourceOnly: { id: "sourceOnly", label: "S", category: "formatting", supports: { wysiwyg: false, source: true } },
  },
  getHeadingLevelFromParams: (params?: { level?: number }) => params?.level ?? 1,
}));

vi.mock("@/plugins/toolbarActions/wysiwygAdapter", () => ({
  performWysiwygToolbarAction: vi.fn(() => true),
  setWysiwygHeadingLevel: vi.fn(() => true),
}));
vi.mock("@/plugins/toolbarActions/sourceAdapter", () => ({
  performSourceToolbarAction: vi.fn(() => true),
  setSourceHeadingLevel: vi.fn(() => true),
}));
vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: () => null,
  getSourceMultiSelectionContext: () => null,
}));
vi.mock("@/services/history/unifiedHistory", () => ({
  performUnifiedUndo: vi.fn(() => true),
  performUnifiedRedo: vi.fn(() => true),
}));
vi.mock("@/utils/debug", () => ({
  menuDispatcherLog: vi.fn(),
  menuDispatcherWarn: vi.fn(),
}));

import { runEditorAction } from "./runEditorAction";
import {
  getEditorActionOwner,
  disposeEditorActionOwner,
} from "./editorActionOwner";
import { isEffectiveSourceMode } from "./editorActionGates";
import {
  performWysiwygToolbarAction,
  setWysiwygHeadingLevel,
} from "@/plugins/toolbarActions/wysiwygAdapter";
import { performSourceToolbarAction } from "@/plugins/toolbarActions/sourceAdapter";
import { performUnifiedUndo, performUnifiedRedo } from "@/services/history/unifiedHistory";

function flushPm() {
  const q = [...ime.pmQueue];
  ime.pmQueue.length = 0;
  q.forEach((fn) => fn());
}

function flushCm() {
  const q = [...ime.cmQueue];
  ime.cmQueue.length = 0;
  q.forEach((fn) => fn());
}

const VIEW = {} as object;

/** A minimal live document tab — the gate requires one for any action. */
function docTab(id: string): Tab {
  return { id, title: id, kind: "document", filePath: `/${id}.md`, formatId: "markdown" } as unknown as Tab;
}

beforeEach(() => {
  vi.clearAllMocks();
  ime.pmComposing = false;
  ime.cmComposing = false;
  ime.pmQueue.length = 0;
  ime.cmQueue.length = 0;
  ui.sourceMode = false;
  lfs.forced.clear();
  fmt.policy = { paragraphFormatting: true, insertBlockActions: true, cjkFormatActions: true };
  editors.wysiwyg = { view: VIEW };
  editors.source = VIEW;
  // A live document tab is required for any action to be allowed — the gate now
  // fails closed without one. (getFormatById is mocked to a permissive policy.)
  useTabStore.setState({ tabs: { main: [docTab("tab-a")] }, activeTabId: { main: "tab-a" } });
});

afterEach(() => {
  for (const label of ["main", "winA", "winB"]) disposeEditorActionOwner(label);
});

describe("runEditorAction — parity", () => {
  it("routes undo through unified history, not the editor adapter", () => {
    runEditorAction("undo", { windowLabel: "main" });
    expect(performUnifiedUndo).toHaveBeenCalledWith("main");
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("routes redo through unified history", () => {
    runEditorAction("redo", { windowLabel: "main" });
    expect(performUnifiedRedo).toHaveBeenCalledWith("main");
  });

  it("setHeading passes the level to the adapter", () => {
    runEditorAction("setHeading", { windowLabel: "main", params: { level: 3 } });
    expect(setWysiwygHeadingLevel).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("paragraph sets heading level 0", () => {
    runEditorAction("paragraph", { windowLabel: "main" });
    expect(setWysiwygHeadingLevel).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it("dispatches a plain formatting action to the WYSIWYG adapter", () => {
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).toHaveBeenCalledWith("bold", expect.anything());
  });

  it("routes to the Source adapter in source mode", () => {
    ui.sourceMode = true;
    runEditorAction("bold", { windowLabel: "main" });
    expect(performSourceToolbarAction).toHaveBeenCalledWith("bold", expect.anything());
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("forced-source resolution routes to Source even when the window is WYSIWYG", () => {
    ui.sourceMode = false;
    lfs.forced.add("tab-a");
    expect(isEffectiveSourceMode("main")).toBe(true);
    runEditorAction("bold", { windowLabel: "main" });
    expect(performSourceToolbarAction).toHaveBeenCalled();
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });
});

describe("runEditorAction — execution-time gates", () => {
  it("refuses an action the format's menuPolicy disables", () => {
    fmt.policy.paragraphFormatting = false;
    const doc = {
      id: "tab-doc",
      title: "x",
      kind: "document",
      filePath: "/x.md",
      formatId: "markdown",
    } as unknown as Tab;
    useTabStore.setState({ tabs: { main: [doc] }, activeTabId: { main: "tab-doc" } });
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("fails closed on a non-document (browser) tab", () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://example.com");
    useTabStore.setState({ activeTabId: { main: tabId } });
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("refuses a source-only action in WYSIWYG mode", () => {
    runEditorAction("sourceOnly" as ActionId, { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("refuses a wysiwyg-only action in source mode", () => {
    ui.sourceMode = true;
    runEditorAction("wysiwygOnly" as ActionId, { windowLabel: "main" });
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("has no focus gate — runs unconditionally (the gate lives in the hook)", () => {
    // This suite mocks NOTHING from @/utils/focusGuard because the executor does
    // not import it — there is no focus dependency to stub. The executor running
    // here proves it is invocation-source agnostic; the complementary proof (a
    // menu accelerator IS blocked when focus is trapped) lives in the
    // useUnifiedMenuCommands suite, which mocks shouldBlockMenuAction → true.
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).toHaveBeenCalled();
  });

  it("does nothing for an unknown action id", () => {
    runEditorAction("nonexistent" as ActionId, { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performUnifiedUndo).not.toHaveBeenCalled();
  });

  it("does not dispatch when the editor exists but its view is null", () => {
    editors.wysiwyg = { view: null as unknown as object };
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("fails closed when there is no active tab (all tabs closed)", () => {
    useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("fails closed on a dangling active tab id", () => {
    useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: "ghost" } });
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("does not route undo through unified history without a live document tab", () => {
    useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
    runEditorAction("undo", { windowLabel: "main" });
    expect(performUnifiedUndo).not.toHaveBeenCalled();
  });
});

describe("runEditorAction — source-mode parity", () => {
  beforeEach(() => {
    ui.sourceMode = true;
  });

  it("setHeading passes the level to the Source adapter", async () => {
    const { setSourceHeadingLevel } = await import("@/plugins/toolbarActions/sourceAdapter");
    runEditorAction("setHeading", { windowLabel: "main", params: { level: 2 } });
    expect(setSourceHeadingLevel).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("paragraph sets Source heading level 0", async () => {
    const { setSourceHeadingLevel } = await import("@/plugins/toolbarActions/sourceAdapter");
    runEditorAction("paragraph", { windowLabel: "main" });
    expect(setSourceHeadingLevel).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it("does not dispatch when the source view is unavailable", () => {
    editors.source = null;
    runEditorAction("bold", { windowLabel: "main" });
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });
});

describe("runEditorAction — IME-deferred ownership (hardening #2)", () => {
  it("runs a queued action when the tab has NOT changed", () => {
    ime.pmComposing = true;
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled(); // queued
    flushPm();
    expect(performWysiwygToolbarAction).toHaveBeenCalledWith("bold", expect.anything());
  });

  it("DROPS a queued action when the tab changed before composition ended", () => {
    ime.pmComposing = true;
    runEditorAction("bold", { windowLabel: "main" }); // captured origin = tab-a
    useTabStore.setState({ activeTabId: { main: "tab-b" } }); // user switched tab
    flushPm(); // compositionend flushes the queued action
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("DROPS a queued action when the editor remounted for the same tab", () => {
    ime.pmComposing = true;
    runEditorAction("bold", { windowLabel: "main" }); // captures editor instance A
    editors.wysiwyg = { view: {} as object }; // same tab, editor remounted (instance B)
    flushPm();
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("DROPS a queued action when the window's owner was disposed (unmount)", () => {
    ime.pmComposing = true;
    runEditorAction("bold", { windowLabel: "main" });
    disposeEditorActionOwner("main"); // editor host unmounted mid-composition
    flushPm();
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("applies a queued Source action when the tab is unchanged, drops it when changed", () => {
    ui.sourceMode = true;
    ime.cmComposing = true;
    runEditorAction("bold", { windowLabel: "main" });
    expect(performSourceToolbarAction).not.toHaveBeenCalled(); // queued
    useTabStore.setState({ activeTabId: { main: "tab-b" } });
    flushCm();
    expect(performSourceToolbarAction).not.toHaveBeenCalled(); // dropped on tab change

    // A second, unchanged-tab composition still applies.
    vi.clearAllMocks();
    useTabStore.setState({ activeTabId: { main: "tab-a" } });
    ime.cmComposing = true;
    runEditorAction("bold", { windowLabel: "main" });
    flushCm();
    expect(performSourceToolbarAction).toHaveBeenCalledWith("bold", expect.anything());
  });

  it("DROPS a queued Source action when the view remounted for the same tab", () => {
    ui.sourceMode = true;
    ime.cmComposing = true;
    runEditorAction("bold", { windowLabel: "main" }); // captures Source view A
    editors.source = {} as object; // same tab, view remounted (instance B)
    flushCm();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("DROPS a queued Source action when the window's owner was disposed", () => {
    ui.sourceMode = true;
    ime.cmComposing = true;
    runEditorAction("bold", { windowLabel: "main" });
    disposeEditorActionOwner("main");
    flushCm();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("DROPS a queued action when the effective surface flipped before flush", () => {
    ime.pmComposing = true;
    runEditorAction("bold", { windowLabel: "main" }); // captured surface = wysiwyg
    ui.sourceMode = true; // user toggled to source mode during composition
    flushPm();
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });
});

describe("runEditorAction — tab-bound retry (hardening #1)", () => {
  it("retries when the editor is not yet mounted, then dispatches", () => {
    vi.useFakeTimers();
    editors.wysiwyg = null; // not mounted yet
    runEditorAction("bold", { windowLabel: "main" });
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    editors.wysiwyg = { view: VIEW }; // mounts before the retry fires
    vi.advanceTimersByTime(60);
    expect(performWysiwygToolbarAction).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("drops a retry when the active tab changed during the retry window", () => {
    vi.useFakeTimers();
    editors.wysiwyg = null;
    runEditorAction("bold", { windowLabel: "main" }); // origin = tab-a
    editors.wysiwyg = { view: VIEW };
    useTabStore.setState({ activeTabId: { main: "tab-b" } });
    vi.advanceTimersByTime(60);
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("drops a retry when the effective surface flipped during the retry window", () => {
    // Same tab, but the user toggled to source mode while the WYSIWYG editor was
    // still mounting. The retry must NOT dispatch to the originally-captured
    // WYSIWYG surface even though that editor becomes available.
    vi.useFakeTimers();
    editors.wysiwyg = null;
    runEditorAction("bold", { windowLabel: "main" }); // captured surface = wysiwyg
    ui.sourceMode = true; // mode toggled during the retry window
    editors.wysiwyg = { view: VIEW }; // WYSIWYG editor becomes available
    vi.advanceTimersByTime(60);
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("per-window retry owner (hardening #3)", () => {
  it("disposing one window's owner does not cancel another window's retries", () => {
    vi.useFakeTimers();
    const a = getEditorActionOwner("winA");
    const b = getEditorActionOwner("winB");
    const ranA = vi.fn();
    const ranB = vi.fn();
    a.scheduleRetry(ranA);
    b.scheduleRetry(ranB);
    disposeEditorActionOwner("winA");
    vi.advanceTimersByTime(100);
    expect(ranA).not.toHaveBeenCalled();
    expect(ranB).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a disposed owner schedules no further retries", () => {
    vi.useFakeTimers();
    const a = getEditorActionOwner("winA");
    a.dispose();
    const ran = vi.fn();
    a.scheduleRetry(ran);
    vi.advanceTimersByTime(100);
    expect(ran).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns the same owner instance for a window until disposed", () => {
    const first = getEditorActionOwner("winA");
    expect(getEditorActionOwner("winA")).toBe(first);
    disposeEditorActionOwner("winA");
    expect(getEditorActionOwner("winA")).not.toBe(first);
  });

  it("re-disposing a replaced owner does not evict its replacement", () => {
    vi.useFakeTimers();
    const a = getEditorActionOwner("winA");
    a.dispose(); // A evicts itself
    const b = getEditorActionOwner("winA"); // fresh owner B for the same label
    expect(b).not.toBe(a);
    a.dispose(); // stale double-dispose of A must NOT evict B
    expect(getEditorActionOwner("winA")).toBe(b);
    const ran = vi.fn();
    b.scheduleRetry(ran); // B is still live
    vi.advanceTimersByTime(100);
    expect(ran).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("runEditorAction — cross-window retry isolation", () => {
  it("disposing one window's retries does not stop another window's", () => {
    vi.useFakeTimers();
    editors.wysiwyg = null; // no editor yet → both windows schedule a retry
    useTabStore.setState({
      tabs: { main: [docTab("tab-a")], win2: [docTab("tab-2")] },
      activeTabId: { main: "tab-a", win2: "tab-2" },
    });
    runEditorAction("bold", { windowLabel: "main" });
    runEditorAction("bold", { windowLabel: "win2" });
    editors.wysiwyg = { view: VIEW }; // editor mounts before the retries fire
    disposeEditorActionOwner("main"); // cancel only main's pending retry
    vi.advanceTimersByTime(60);
    // Only win2's retry survives → exactly one dispatch.
    expect(performWysiwygToolbarAction).toHaveBeenCalledTimes(1);
    disposeEditorActionOwner("win2");
    vi.useRealTimers();
  });
});
