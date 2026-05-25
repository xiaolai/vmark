/**
 * Theme-unification spike — Phase 0 (TEMPORARY, delete after Phase 2).
 *
 * Locks in the current xterm ITheme output for each of the 5 vmark
 * themes BEFORE we migrate buildXtermTheme() onto the typed
 * ThemeTokens path. The inline snapshot here is the frozen baseline
 * the post-migration code must match byte-for-byte.
 *
 * See dev-docs/grills/theme-unification-2026-05/README.md for context.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  buildXtermThemeForId,
} from "@/components/Terminal/terminalTheme";
import type { ThemeId } from "@/stores/settingsStore";

const themeIds: ThemeId[] = ["white", "paper", "mint", "sepia", "night"];

describe("Phase-0 spike: ITheme baseline per theme", () => {
  for (const id of themeIds) {
    it(`${id} — non-empty 16-ANSI + base colors + scrollbar`, () => {
      const t = buildXtermThemeForId(id);

      expect(t.background).toBeTruthy();
      expect(t.foreground).toBeTruthy();
      expect(t.cursor).toBeTruthy();
      expect(t.cursorAccent).toBeTruthy();
      expect(t.selectionBackground).toBeTruthy();

      for (const k of [
        "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        "brightBlack", "brightRed", "brightGreen", "brightYellow",
        "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
      ] as const) {
        expect(t[k], `${id}.${k}`).toBeTruthy();
      }

      expect(t.scrollbarSliderBackground).toBeTruthy();
      expect(t.scrollbarSliderHoverBackground).toBeTruthy();
      expect(t.scrollbarSliderActiveBackground).toBeTruthy();
    });

    it(`${id} — locked baseline snapshot`, () => {
      expect(buildXtermThemeForId(id)).toMatchSnapshot();
    });
  }
});
