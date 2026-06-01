/**
 * Live-sync tests for the terminalSessionStoreSync subscribe effects.
 *
 * Covers:
 *   - screenReaderMode change applies to live sessions (G3/WI-3.1)
 *   - scrollback change applies to live sessions (G7/WI-4.2)
 *   - fontFamily re-resolves from --font-mono on a theme change (G6/WI-4.1)
 *
 * Drives the real useSettingsStore; @/theme and createTerminalInstance's
 * resolveMonoFont are mocked so the effects have stable, observable outputs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";

const { mockResolveMonoFont, mockBuildTheme } = vi.hoisted(() => ({
  mockResolveMonoFont: vi.fn(() => "MockMono, monospace"),
  mockBuildTheme: vi.fn((id: string) => ({ background: `#theme-${id}` })),
}));

vi.mock("@/theme", () => ({
  buildXtermThemeForId: (...args: unknown[]) => mockBuildTheme(...(args as [string])),
}));

vi.mock("./createTerminalInstance", () => ({
  resolveMonoFont: () => mockResolveMonoFont(),
}));

import { useUIStoreSync, type SyncableSessionEntry } from "./terminalSessionStoreSync";
import { useSettingsStore } from "@/stores/settingsStore";

/** Build a fake session entry exposing only the fields the sync effects touch. */
function makeEntry(): SyncableSessionEntry {
  const options: Record<string, unknown> = {};
  return {
    instance: {
      // Only `term.options` and `fitAddon.fit` are touched by the effects.
      term: { options } as any,
      fitAddon: { fit: vi.fn() } as any,
      isShellBusy: () => false,
      getCwd: () => null,
    } as any,
    pty: null,
    shellExited: false,
    spawnedCwd: undefined,
  };
}

describe("terminalSessionStoreSync live effects", () => {
  let entry: SyncableSessionEntry;
  let sessionsRef: RefObject<Map<string, SyncableSessionEntry>>;

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().resetSettings();
    entry = makeEntry();
    sessionsRef = { current: new Map([["s1", entry]]) };
  });

  it("flips term.options.screenReaderMode when the setting changes (G3)", () => {
    renderHook(() => useUIStoreSync(sessionsRef));
    expect(entry.instance.term.options.screenReaderMode).toBeUndefined();

    useSettingsStore.getState().updateTerminalSetting("screenReaderMode", true);
    expect(entry.instance.term.options.screenReaderMode).toBe(true);

    useSettingsStore.getState().updateTerminalSetting("screenReaderMode", false);
    expect(entry.instance.term.options.screenReaderMode).toBe(false);
  });

  it("updates term.options.scrollback when the setting changes (G7)", () => {
    renderHook(() => useUIStoreSync(sessionsRef));

    useSettingsStore.getState().updateTerminalSetting("scrollback", 50000);
    expect(entry.instance.term.options.scrollback).toBe(50000);
  });

  it("re-resolves fontFamily on a theme change (G6)", () => {
    renderHook(() => useUIStoreSync(sessionsRef));
    mockResolveMonoFont.mockReturnValue("ThemeFont, monospace");

    // Pick a theme different from the current one to trigger the theme block.
    const current = useSettingsStore.getState().appearance.theme;
    const next = current === "paper" ? "night" : "paper";
    useSettingsStore.getState().updateAppearanceSetting("theme", next as any);

    expect(entry.instance.term.options.fontFamily).toBe("ThemeFont, monospace");
    expect(entry.instance.term.options.theme).toEqual({ background: `#theme-${next}` });
  });
});
