// #1554 — F6 inside a two-document split must settle after ONE mode switch.
//
// The reported loop: F6 flips the window to Source; both panes remount their
// editor and each remount took DOM focus; the background pane's focus moved
// the split's focused pane, which rewrote `activeTabId`; the per-tab mode
// mirror then flipped the window back to that document's own (WYSIWYG) mode;
// both panes remounted again, the other pane took focus — forever.
//
// REAL: DocumentSplitContainer and every editor under it (Tiptap and
// CodeMirror), the per-tab mode mirror, the F6 handler, and the tab, pane,
// document and ui stores behind the real open flow. FAKED: `@tauri-apps/*`
// only (the stateful in-memory disk).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { WindowContext } from "@/contexts/WindowContext";
import { DocumentSplitContainer } from "./DocumentSplitContainer";
import { useTabModeSync } from "@/hooks/useTabModeSync";
import { toggleSourceModeWithCheckpoint } from "@/services/history/unifiedHistory";
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import { getEditorScrollOffset } from "@/services/editor/scrollPosition";
import { ROOT, WINDOW, openDocInTab, resetTier0 } from "@/test/tier0/harness";

/** Let every pending frame, focus timer and lazy chunk run. */
const settle = (ms = 500): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** jsdom has no layout and does not define these on Range; the editors only need them to exist. */
const LAYOUT_STUBS: Array<[object, string, () => unknown]> = [
  [Range.prototype, "getClientRects", () => []],
  [Range.prototype, "getBoundingClientRect", () => new DOMRect()],
];

/** The window as App composes it for this flow: the mode mirror plus the split. */
function SplitWindow() {
  useTabModeSync();
  return <DocumentSplitContainer />;
}

/** Count every change of the window mode and of the split's focused pane. */
function watchTransitions(): { modeFlips: () => number; paneMoves: () => number; stop: () => void } {
  let modeFlips = 0;
  let paneMoves = 0;
  const stopUi = useUIStore.subscribe((s, prev) => {
    if (s.sourceMode !== prev.sourceMode) modeFlips += 1;
  });
  const stopPane = usePaneStore.subscribe((s, prev) => {
    if (s.byWindow[WINDOW]?.focusedPane !== prev.byWindow[WINDOW]?.focusedPane) paneMoves += 1;
  });
  return {
    modeFlips: () => modeFlips,
    paneMoves: () => paneMoves,
    stop: () => {
      stopUi();
      stopPane();
    },
  };
}

beforeAll(async () => {
  // Warm the lazily imported surfaces so a pane's Suspense resolves within a
  // settle() rather than on the transform pipeline's wall-clock time.
  await import("@/lib/formats/adapters/markdownSurface");
  await import("@/components/Editor/SourceEditor");
  bootstrapFormats();
  bindPluginHostSettings();
  for (const [proto, key, impl] of LAYOUT_STUBS) {
    if (!(key in proto)) Object.defineProperty(proto, key, { value: impl, configurable: true });
  }
});

let a: string;
let b: string;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetTier0();
  usePaneStore.setState({ byWindow: {} });
  useUIStore.setState({ sourceMode: false, markdownSplitView: false });
  // Two documents, the split opened from the first: focus lands on the second.
  a = await openDocInTab(`${ROOT}/a.md`, "# Alpha\n\nleft pane\n");
  b = await openDocInTab(`${ROOT}/b.md`, "# Beta\n\nright pane\n");
  useTabStore.getState().setActiveTab(WINDOW, a);
  usePaneStore.getState().openSplit(WINDOW, b);
  expect(usePaneStore.getState().getSplit(WINDOW)).toMatchObject({
    primaryTabId: a,
    secondaryTabId: b,
    focusedPane: "secondary",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** How many panes currently show a Source (CodeMirror) / WYSIWYG (ProseMirror) editor. */
const panesShowing = (selector: string): number =>
  document.querySelectorAll(`.document-split__pane ${selector}`).length;

/** Mount the window and wait until both panes show their WYSIWYG editor. */
async function renderWindow(): Promise<void> {
  render(
    <WindowContext.Provider value={{ windowLabel: WINDOW, isDocumentWindow: true }}>
      <SplitWindow />
    </WindowContext.Provider>,
  );
  await vi.waitFor(async () => {
    await settle(100);
    expect(panesShowing(".ProseMirror")).toBe(2);
  }, { timeout: 20_000 });
  await settle();
}

describe("F6 inside a two-document split (#1554)", () => {
  it("switches both panes to Source once and then stays put", async () => {
    await renderWindow();
    const watch = watchTransitions();

    act(() => toggleSourceModeWithCheckpoint(WINDOW)); // F6
    await settle(3000); // many remount/focus rounds if the loop is live

    expect(watch.modeFlips()).toBe(1);
    expect(watch.paneMoves()).toBe(0);
    expect(useUIStore.getState().sourceMode).toBe(true);
    expect(usePaneStore.getState().getSplit(WINDOW).focusedPane).toBe("secondary");
    expect(panesShowing(".cm-editor")).toBe(2);
    watch.stop();
  });

  it("F6 again returns both panes to WYSIWYG once", async () => {
    await renderWindow();
    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(1000);
    const watch = watchTransitions();

    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(3000);

    expect(watch.modeFlips()).toBe(1);
    expect(watch.paneMoves()).toBe(0);
    expect(useUIStore.getState().sourceMode).toBe(false);
    expect(panesShowing(".cm-editor")).toBe(0);
    watch.stop();
  });

  it("rapid repeated F6 settles on the parity of the presses", async () => {
    await renderWindow();
    const watch = watchTransitions();

    for (let i = 0; i < 3; i += 1) act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(3000);

    expect(watch.modeFlips()).toBe(3);
    expect(watch.paneMoves()).toBe(0);
    expect(useUIStore.getState().sourceMode).toBe(true);
    watch.stop();
  });

  it("the primary pane focused: F6 keeps focus there and does not loop", async () => {
    act(() => usePaneStore.getState().setFocusedPane(WINDOW, "primary"));
    await renderWindow();
    const watch = watchTransitions();

    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(3000);

    expect(watch.modeFlips()).toBe(1);
    expect(watch.paneMoves()).toBe(0);
    expect(usePaneStore.getState().getSplit(WINDOW).focusedPane).toBe("primary");
    watch.stop();
  });

  it("each pane's Source editor remembers its OWN document's reading position", async () => {
    // Both panes mount in one F6; the background pane used to bind itself to
    // the window's active tab — the OTHER pane's document.
    await renderWindow();
    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(3000);
    const [left] = document.querySelectorAll<HTMLElement>(".document-split__pane .cm-scroller");
    // jsdom has no layout: give the scroller a scrollable extent.
    Object.defineProperty(left, "scrollHeight", { value: 4000, configurable: true });
    Object.defineProperty(left, "clientHeight", { value: 500, configurable: true });
    left.scrollTop = 300;
    left.dispatchEvent(new Event("scroll"));
    await settle(500);

    expect(getEditorScrollOffset(a, "source")).toBe(300);
    expect(getEditorScrollOffset(b, "source")).not.toBe(300);
  });

  it("keep-both-editors-alive: the show path also leaves focus where it was", async () => {
    // Both editors stay mounted and F6 only flips `hidden` — the second focus
    // path (hidden → visible) in each editor, which had the same flaw.
    useSettingsStore.setState((st) => ({ advanced: { ...st.advanced, keepBothEditorsAlive: true } }));
    await renderWindow();
    const watch = watchTransitions();

    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(2000);
    act(() => toggleSourceModeWithCheckpoint(WINDOW));
    await settle(2000);

    expect(watch.modeFlips()).toBe(2);
    expect(watch.paneMoves()).toBe(0);
    expect(usePaneStore.getState().getSplit(WINDOW).focusedPane).toBe("secondary");
    watch.stop();
  });
});
