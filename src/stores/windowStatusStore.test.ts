// @vitest-environment node
// Window status store (#1057) — snapshot mirror + panel toggle + ranking.
// Pin + per-window persistence (#1120).
import { beforeEach, describe, expect, it } from "vitest";
import {
  useWindowStatusStore,
  selectWindows,
  selectPanelOpen,
  selectPinned,
  selectGlobalPin,
  selectEffectivePinned,
  selectOtherWindowsRanked,
  type WindowStatusEntry,
} from "./windowStatusStore";
import {
  getCurrentWindowLabel,
  setCurrentWindowLabel,
} from "@/services/persistence/workspaceStorage";
import { getWindowStatusStorageKey } from "@/services/persistence/windowStatusStorage";

function entry(p: Partial<WindowStatusEntry> & { label: string }): WindowStatusEntry {
  return { docName: p.label, ai: "idle", elapsedSeconds: 0, attention: false, ...p };
}

beforeEach(() => {
  localStorage.clear();
  setCurrentWindowLabel("main");
  useWindowStatusStore.getState().reset();
});

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

describe("windowStatusStore — pin + persistence (#1120)", () => {
  it("togglePinned / setPinned control the pin", () => {
    expect(selectPinned(useWindowStatusStore.getState())).toBe(false);
    useWindowStatusStore.getState().togglePinned();
    expect(selectPinned(useWindowStatusStore.getState())).toBe(true);
    useWindowStatusStore.getState().setPinned(false);
    expect(selectPinned(useWindowStatusStore.getState())).toBe(false);
  });

  it("reset also clears the pin", () => {
    useWindowStatusStore.getState().setPinned(true);
    useWindowStatusStore.getState().reset();
    expect(selectPinned(useWindowStatusStore.getState())).toBe(false);
  });

  it("persists panelOpen and pinned but never the live window snapshot", () => {
    useWindowStatusStore.getState().setWindows([entry({ label: "a" })]);
    useWindowStatusStore.getState().setPinned(true);
    useWindowStatusStore.getState().setPanelOpen(true);

    const raw = localStorage.getItem(getWindowStatusStorageKey(getCurrentWindowLabel()));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    // Only the two prefs — the Rust-owned `windows` array must not be persisted.
    expect(parsed.state).toEqual({ panelOpen: true, pinned: true });
    expect(parsed.state.windows).toBeUndefined();
  });

  it("keeps each window's prefs under its own key", () => {
    useWindowStatusStore.getState().setPinned(true);
    expect(localStorage.getItem("vmark-window-status:main")).toBeTruthy();
    // A different window label writes to a different key.
    setCurrentWindowLabel("doc-9");
    useWindowStatusStore.getState().setPinned(false);
    expect(localStorage.getItem("vmark-window-status:doc-9")).toBeTruthy();
  });
});

describe("windowStatusStore — global pin (#1135)", () => {
  it("setGlobalPin(true) enables the flag and opens this window's panel", () => {
    expect(selectGlobalPin(useWindowStatusStore.getState())).toBe(false);
    useWindowStatusStore.getState().setGlobalPin(true);
    expect(selectGlobalPin(useWindowStatusStore.getState())).toBe(true);
    // Enabling surfaces the panel immediately in the acting window.
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(true);
  });

  it("setGlobalPin(false) disables the flag without force-closing the panel", () => {
    useWindowStatusStore.getState().setGlobalPin(true);
    useWindowStatusStore.getState().setGlobalPin(false);
    expect(selectGlobalPin(useWindowStatusStore.getState())).toBe(false);
    // Disabling leaves the panel as-is — each window falls back to its own state.
    expect(selectPanelOpen(useWindowStatusStore.getState())).toBe(true);
  });

  it("effective pin is true when EITHER the window pin or the global pin is on", () => {
    expect(selectEffectivePinned(useWindowStatusStore.getState())).toBe(false);
    useWindowStatusStore.getState().setPinned(true);
    expect(selectEffectivePinned(useWindowStatusStore.getState())).toBe(true);
    useWindowStatusStore.getState().setPinned(false);
    useWindowStatusStore.getState().setGlobalPin(true);
    expect(selectEffectivePinned(useWindowStatusStore.getState())).toBe(true);
  });

  it("persists the global pin app-wide, never inside a window-scoped blob", () => {
    useWindowStatusStore.getState().setGlobalPin(true);
    // App-global key holds it...
    expect(localStorage.getItem("vmark-window-status:__global-pin")).toBe("1");
    // ...and it must NOT leak into this window's per-window prefs.
    const raw = localStorage.getItem(getWindowStatusStorageKey(getCurrentWindowLabel()));
    if (raw) expect(JSON.parse(raw).state.globalPin).toBeUndefined();
  });

  it("reset clears the global pin (state + persistence)", () => {
    useWindowStatusStore.getState().setGlobalPin(true);
    useWindowStatusStore.getState().reset();
    expect(selectGlobalPin(useWindowStatusStore.getState())).toBe(false);
    expect(localStorage.getItem("vmark-window-status:__global-pin")).toBeNull();
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
