/**
 * currentTerminalThemeId — the theme id a terminal session should render with,
 * right now, for this window.
 *
 * Composes two reads that both terminal entry points need: the effective app
 * theme, and whether a browser tab has focus (which collapses the terminal to a
 * neutral palette — see theme/terminalThemeForBrowser.ts for why).
 *
 * It lives HERE rather than in `@/theme` on purpose. `@/theme` must not import
 * the stores: `buildXtermTheme.ts` records that a back-edge there creates a
 * dependency cycle (settingsStore → @/theme → buildXtermTheme → settingsStore),
 * which is why `resolveTerminalThemeId` takes its inputs as parameters and stays
 * pure. This module is where the impure reads are allowed to meet it.
 *
 * @coordinates-with theme/terminalThemeForBrowser.ts — the pure rule
 * @coordinates-with useTerminalSessions.ts — session creation
 * @coordinates-with terminalSessionStoreSync.ts — live retheming
 * @module components/Terminal/terminalThemeId
 */

import { getEffectiveThemeId } from "@/hooks/useEffectiveTheme";
import { getBrowserWorkspaceActive } from "@/services/browser/browserWorkspaceActive";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { resolveTerminalThemeId, type ThemeId } from "@/theme";

export function currentTerminalThemeId(): ThemeId {
  return resolveTerminalThemeId(
    getEffectiveThemeId(),
    getBrowserWorkspaceActive(getCurrentWindowLabel()),
  );
}
