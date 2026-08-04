// WI-17 — Tier-0 AUTOSAVE flow over the REAL composition: the real useAutoSave
// hook (mounted through the real WindowContext), the real settings store, the
// real saveToPath, against the stateful fs fake. Writes are counted and read
// back from the fake disk — a debounce regression shows up as zero writes
// (silent data loss) or as per-tick writes, and both are visible here.
//
// VMark's autosave is INTERVAL-driven with a floor on the gap between two
// successful saves; it is not an edit-triggered debounce. The boundary case
// below is therefore "no write before the interval elapses, and the write that
// does land carries the FINAL content" — the real reset property.
// Protocol context: decision ledger D6 (.claude/tdd-guardian/decisions-20260803.md).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { WindowContext } from "@/contexts/WindowContext";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { statefulFs } from "@/test/statefulFsFake";
import {
  WINDOW,
  ROOT,
  resetTier0,
  openDocInTab,
  newUntitledTab,
  editDoc,
  doc,
  settle,
} from "./harness";

const DOC = `${ROOT}/auto.md`;
const ORIGINAL = "# 自动保存\n\n初始内容。\n";
const FIRST_EDIT = "# 自动保存\n\n第一次修改。\n";
const FINAL_EDIT = "# 自动保存\n\n最终内容。\n";

/** Autosave interval in seconds, and the same value in ms. */
const INTERVAL_S = 2;
const INTERVAL_MS = INTERVAL_S * 1000;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    WindowContext.Provider,
    { value: { windowLabel: WINDOW, isDocumentWindow: true } },
    children,
  );
}

/** Mount the real hook with autosave enabled at INTERVAL_S. */
function mountAutoSave() {
  useSettingsStore.setState((s) => ({
    general: { ...s.general, autoSaveEnabled: true, autoSaveInterval: INTERVAL_S },
  }));
  return renderHook(() => useAutoSave(), { wrapper });
}

beforeEach(() => {
  resetTier0();
  // History OFF for this suite only. `recordHistorySnapshot` is AWAITED inside
  // the save (close flows need that), and it hashes the path with
  // `crypto.subtle.digest` — a threadpool-backed promise that cannot settle
  // while the fake clock owns every timer, so the save's `finally` (which
  // releases the hook's re-entry ref) would never run and every later tick
  // would silently skip. The history composition is exercised for real in
  // saveFlow.test.ts, which awaits the whole chain without fake timers.
  useSettingsStore.setState((s) => ({ general: { ...s.general, historyEnabled: false } }));
  vi.useFakeTimers();
});

afterEach(async () => {
  // Finish anything a final tick left in flight, so it cannot land as a
  // phantom write inside the next test.
  await settle();
  vi.useRealTimers();
});

describe("Tier-0 autosave flow (case 3)", () => {
  it("an edit reaches disk after the interval elapses — exactly one write, correct bytes", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();
    editDoc(tabId, FINAL_EDIT);

    expect(statefulFs.writesTo(DOC)).toEqual([]); // nothing yet
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 10);
    await settle();

    expect(statefulFs.writesTo(DOC)).toEqual([
      { path: DOC, content: FINAL_EDIT, via: "atomic_write_file" },
    ]);
    expect(statefulFs.read(DOC)).toBe(FINAL_EDIT);
    expect(doc(tabId).isDirty).toBe(false);
    view.unmount();
  });

  it("a clean document is never written, however many intervals pass", async () => {
    await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    await settle();

    expect(statefulFs.writes).toEqual([]);
    view.unmount();
  });

  it("an untitled document is skipped — autosave never invents a path", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "未命名草稿\n");
    const view = mountAutoSave();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    await settle();

    expect(statefulFs.writes).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
    view.unmount();
  });

  it("a divergent document (user kept local changes) is skipped", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, FINAL_EDIT);
    useDocumentStore.getState().markDivergent(tabId);
    const view = mountAutoSave();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    await settle();

    expect(statefulFs.writes).toEqual([]);
    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    view.unmount();
  });

  it("unmounting stops the timer — no write lands after the hook is gone", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();
    editDoc(tabId, FINAL_EDIT);

    view.unmount();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    await settle();

    expect(statefulFs.writes).toEqual([]);
  });
});

describe("Tier-0 autosave flow — interval boundary (case 4)", () => {
  it("an edit just before the tick, then another: ONE write carrying the FINAL content", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();

    editDoc(tabId, FIRST_EDIT);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    await settle(); // interval − ε
    expect(statefulFs.writesTo(DOC)).toEqual([]); // boundary: not yet

    editDoc(tabId, FINAL_EDIT); // the tick must read THIS, not the snapshot
    await vi.advanceTimersByTimeAsync(50);
    await settle();

    expect(statefulFs.writesTo(DOC)).toEqual([
      { path: DOC, content: FINAL_EDIT, via: "atomic_write_file" },
    ]);
    expect(statefulFs.read(DOC)).toBe(FINAL_EDIT);
    view.unmount();
  });

  it("the inter-save floor holds: the next tick after a save does not write again", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();
    editDoc(tabId, FIRST_EDIT);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 10);
    await settle();
    expect(statefulFs.writesTo(DOC)).toHaveLength(1);

    editDoc(tabId, FINAL_EDIT);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 10);
    await settle(); // still inside the floor

    expect(statefulFs.writesTo(DOC)).toHaveLength(1);
    expect(statefulFs.read(DOC)).toBe(FIRST_EDIT);
    expect(doc(tabId).isDirty).toBe(true); // the newer edit is still pending, not lost

    await vi.advanceTimersByTimeAsync(5000);
    await settle(); // past the floor
    expect(statefulFs.read(DOC)).toBe(FINAL_EDIT);
    expect(doc(tabId).isDirty).toBe(false);
    view.unmount();
  });

  it("a failing disk keeps the document dirty and the previous bytes intact", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    const view = mountAutoSave();
    editDoc(tabId, FINAL_EDIT);
    statefulFs.failWrites(new Error("disk full"));

    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 10);
    await settle();

    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(doc(tabId).isDirty).toBe(true);
    expect(doc(tabId).content).toBe(FINAL_EDIT);

    // Recovery: the very next tick writes it (no floor — nothing succeeded).
    statefulFs.failWrites(null);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 10);
    await settle();
    expect(statefulFs.read(DOC)).toBe(FINAL_EDIT);
    expect(doc(tabId).isDirty).toBe(false);
    view.unmount();
  });
});
