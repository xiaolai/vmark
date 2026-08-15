/**
 * Live-sync tests for the terminalSessionStoreSync subscribe effects.
 *
 * Covers:
 *   - screenReaderMode change applies to live sessions (G3/WI-3.1)
 *   - scrollback change applies to live sessions (G7/WI-4.2)
 *   - fontFamily re-applies on a theme change, resolved from the monoFont
 *     setting (G6/WI-4.1)
 *   - fontFamily updates on a monoFont-only change (the stale-read fix)
 *
 * Drives the real useSettingsStore; @/theme and @/utils/fontStacks'
 * resolveMonoFontStack are mocked so the effects have stable, observable
 * outputs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";

const { mockResolveMonoFontStack, mockBuildTheme } = vi.hoisted(() => ({
  mockResolveMonoFontStack: vi.fn((mono: string) => `Mock(${mono}), monospace`),
  mockBuildTheme: vi.fn((id: string) => ({ background: `#theme-${id}` })),
}));

// Only `buildXtermThemeForId` is stubbed. `resolveTerminalThemeId` stays REAL so
// these tests keep exercising the actual browser-neutral rule rather than a
// stub that would pass no matter what that resolver did.
vi.mock("@/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/theme")>()),
  buildXtermThemeForId: (...args: unknown[]) => mockBuildTheme(...(args as [string])),
}));

vi.mock("@/utils/fontStacks", () => ({
  resolveMonoFontStack: (mono: string) => mockResolveMonoFontStack(mono),
}));

// Pin the full theme catalog. The G6 case below asserts `#theme-${next}`, and
// `getEffectiveThemeId` NARROWS to the light/dark pair on Windows and Linux — so
// on a non-mac runner a `paper` expectation resolves to `white`. It passes there
// today only because the default theme is `paper`, which makes `next` always
// `night` (already a neutral); changing that default would have broken this on
// CI alone. Pinned so the suite tests retheming rather than platform narrowing.
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => true,
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
      setOnShellIdle: vi.fn(),
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

  // Audit 20260815-163607 #16. Creation normalises through `clampScrollback` /
  // `clampContrastRatio`; the LIVE path had its own weaker copies, so a value
  // that terminal creation refuses could still be written into a running xterm.
  // xterm throws on a NaN scrollback, so this is a crash, not a cosmetic drift.
  it.each([
    // Non-finite of any sign falls back to the settings default rather than
    // clamping to an endpoint — Infinity is not "as much scrollback as
    // possible", it is a corrupt value.
    ["NaN", Number.NaN, 5000],
    ["Infinity", Number.POSITIVE_INFINITY, 5000],
    ["-Infinity", Number.NEGATIVE_INFINITY, 5000],
    ["fractional", 1234.7, 1234],
    ["below the floor", 1, 100],
  ])("normalises a %s scrollback the same way creation does", (_label, input, expected) => {
    renderHook(() => useUIStoreSync(sessionsRef));
    useSettingsStore.getState().updateTerminalSetting("scrollback", input as number);
    expect(entry.instance.term.options.scrollback).toBe(expected);
  });

  it.each([
    ["NaN", Number.NaN, 4.5],
    ["above the ceiling", 99, 21],
    ["below the floor", 0, 1],
  ])("normalises a %s contrast ratio the same way creation does", (_label, input, expected) => {
    renderHook(() => useUIStoreSync(sessionsRef));
    useSettingsStore.getState().updateTerminalSetting("minimumContrastRatio", input as number);
    expect(entry.instance.term.options.minimumContrastRatio).toBe(expected);
  });

  it("re-applies fontFamily (from the monoFont setting) on a theme change (G6)", () => {
    renderHook(() => useUIStoreSync(sessionsRef));

    const mono = useSettingsStore.getState().appearance.monoFont;
    // Pick a theme different from the current one to trigger the theme block.
    const current = useSettingsStore.getState().appearance.theme;
    const next = current === "paper" ? "night" : "paper";
    useSettingsStore.getState().updateAppearanceSetting("theme", next as any);

    expect(mockResolveMonoFontStack).toHaveBeenCalledWith(mono);
    expect(entry.instance.term.options.fontFamily).toBe(`Mock(${mono}), monospace`);
    expect(entry.instance.term.options.theme).toEqual({ background: `#theme-${next}` });
  });

  it("updates fontFamily on a monoFont-only change — no theme change (G6, stale-read fix)", () => {
    renderHook(() => useUIStoreSync(sessionsRef));

    useSettingsStore.getState().updateAppearanceSetting("monoFont", "sfmono");

    expect(mockResolveMonoFontStack).toHaveBeenCalledWith("sfmono");
    expect(entry.instance.term.options.fontFamily).toBe("Mock(sfmono), monospace");
    // No theme change → the theme option is never written.
    expect(entry.instance.term.options.theme).toBeUndefined();
  });
});
