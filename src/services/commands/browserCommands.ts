/**
 * Browser commands — the user-facing entry point to the embedded browser (WI-1.10).
 *
 * A single "New Browser Tab" command, gated by the `browser.enabled` setting AND
 * the platform via the CommandBus `when` predicate, so the palette/menu simply
 * don't surface it where it cannot work. Mirrors viewCommands'
 * registration pattern. The command creates (and activates) a browser page in the
 * browser workspace, which `Editor.tsx` renders as a native browser surface.
 *
 * @coordinates-with stores/settingsStore — the `browser.enabled` gate
 * @coordinates-with stores/tabStore — createBrowserPage
 * @module services/commands/browserCommands
 */
import { hasCommand, registerCommand } from "./CommandBus";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { isMacPlatform } from "@/utils/platform";
import i18n from "@/i18n";

/**
 * Is the embedded browser usable here? The setting AND the platform: the native
 * surface exists only on macOS (`surface_stub.rs` everywhere else), and the setting
 * defaults on regardless of platform, so a Windows or Linux build used to offer a
 * command that could only ever show "not available on this platform" (audit
 * 2026-09-03 X-04). One predicate, shared with the native menu item.
 */
export function browserAvailableHere(): boolean {
  return isMacPlatform() && useSettingsStore.getState().browser.enabled;
}

/**
 * Default start page for a new browser tab. DuckDuckGo is a privacy-respecting
 * neutral default; it is not yet a user setting (a `browser.homepage` setting is
 * a natural follow-up).
 */
export const NEW_BROWSER_TAB_URL = "https://duckduckgo.com";

type Ctx = { windowLabel?: string };

/**
 * Register the browser commands on the CommandBus. Idempotent: guards on
 * `hasCommand` (bus state), which is HMR-safe (the bus survives a module reload)
 * and reset-aware (re-registers after `_resetCommandBus` in tests).
 */
export function registerBrowserCommands(): void {
  if (hasCommand("browser.newTab")) return;

  registerCommand({
    id: "browser.newTab",
    title: () => i18n.t("commands:browser.newTab"),
    category: "view",
    when: browserAvailableHere,
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      useTabStore.getState().createBrowserPage(windowLabel, NEW_BROWSER_TAB_URL);
    },
  });
}
