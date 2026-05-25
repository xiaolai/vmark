/**
 * buildXtermTheme regression test — locks the xterm ITheme output per
 * vmark theme. Originally a Phase-0 spike for the theme-unification
 * migration; kept as ongoing insurance against unintentional theme
 * edits.
 *
 * Snapshots live at __snapshots__/buildXtermTheme.regression.test.ts.snap.
 * To intentionally update them: `pnpm vitest run src/theme/buildXtermTheme.regression -u`.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { buildXtermThemeForId, type ThemeId } from "@/theme";

const themeIds: ThemeId[] = ["white", "paper", "mint", "sepia", "night"];

describe("buildXtermTheme — ITheme baseline per theme", () => {
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
