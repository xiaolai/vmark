// Window status store (#1057) — snapshot mirror + panel toggle + ranking.
import { beforeEach, describe, expect, it } from "vitest";
import {
  useWindowStatusStore,
  selectWindows,
  selectPanelOpen,
  selectOtherWindowsRanked,
  type WindowStatusEntry,
} from "./windowStatusStore";

function entry(p: Partial<WindowStatusEntry> & { label: string }): WindowStatusEntry {
  return { docName: p.label, ai: "idle", elapsedSeconds: 0, attention: false, ...p };
}

beforeEach(() => useWindowStatusStore.getState().reset());

describe("windowStatusStore", () => {
  it("setWindows replaces the snapshot; selector reads it", () => {
    const ws = [entry({ label: "a" }), entry({ label: "b" })];
    useWindowStatusStore.getState().setWindows(ws);
    expect(selectWindows(useWindowStatusStore.getState())).toHaveLength(2);
  });

  it("togglePanel / setPanelOpen control the panel", () => {
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(false);
    useWindowStatusStore.getState().togglePanel();
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(true);
    useWindowStatusStore.getState().setPanelOpen(false);
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(false);
  });

  it("reset clears windows and closes the panel", () => {
    useWindowStatusStore.getState().setWindows([entry({ label: "a" })]);
    useWindowStatusStore.getState().setPanelOpen(true);
    useWindowStatusStore.getState().reset();
    expect(selectWindows(useWindowStatusStore.getState())).toEqual([]);
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(false);
  });
});

describe("selectOtherWindowsRanked", () => {
  it("excludes the current window", () => {
    const ws = [entry({ label: "self" }), entry({ label: "other" })];
    const ranked = selectOtherWindowsRanked(ws, "self");
    expect(ranked.map((w) => w.label)).toEqual(["other"]);
  });

  it("ranks attention > error > running > idle, then by doc name", () => {
    const ws = [
      entry({ label: "idle1", docName: "z", ai: "idle" }),
      entry({ label: "run", docName: "m", ai: "running" }),
      entry({ label: "err", docName: "k", ai: "error" }),
      entry({ label: "bell", docName: "b", attention: true, ai: "running" }),
      entry({ label: "idle2", docName: "a", ai: "idle" }),
    ];
    const ranked = selectOtherWindowsRanked(ws, "self");
    expect(ranked.map((w) => w.label)).toEqual(["bell", "err", "run", "idle2", "idle1"]);
  });
});
