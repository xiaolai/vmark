/**
 * Knowledge Base availability — the ONE predicate every entry point shares
 * (#1425).
 *
 * Purpose: no packaged VMark build carries the content server. Nothing in the
 * build produces its `cli.js` (`BUNDLED_CLI_RESOURCE` is `None` in
 * `src-tauri/src/content_server/bundle_manifest.rs`, and the macOS release
 * smoke test asserts `cli=missing` on every release), and nothing in the app
 * downloads or installs a runtime — so on a release install the
 * feature can only ever explain why it cannot start. It shipped with a native
 * menu item, `Ctrl+Shift+4`, a palette command and a customizable shortcut row
 * anyway, and users reported the dead end as a platform bug (#1425 read it as a
 * Linux-only exclusion; it is every platform).
 *
 * So the entry points hide behind Developer Mode, which is exactly what that
 * setting already means here — "reveals the experimental toggles" — and is the
 * same treatment the embedded browser's menu item got for the same reason
 * (`browserAvailableHere`). This is a deliberate interim choice:
 * developer-mode-only until a runtime story exists. When one lands, this
 * predicate is what changes.
 *
 * Read the store on every call, never a captured value: the toggle must take
 * effect without a reload.
 *
 * Hiding the entry points does NOT stop a running server — turning the
 * setting off mid-session leaves it running, and turning Developer Mode back
 * on reaches its Stop button again. An open panel DOES close, because it has
 * no close button of its own (`KnowledgeBaseOverlay.tsx`).
 *
 * @coordinates-with services/commands/viewCommands — the `when` predicate
 * @coordinates-with services/menu/conditionalMenuItemSync — the native item
 * @coordinates-with services/commands/browserCommands — `browserAvailableHere`, the same pattern
 * @module services/contentServer/availability
 */
import { useSettingsStore } from "@/stores/settingsStore";
import type { SettingsState } from "@/stores/settingsTypes";

/**
 * Selector form, for a component that must RE-RENDER when availability
 * changes. One definition in two shapes: `knowledgeBaseAvailableHere` reads it
 * off the current state, so the two can never disagree about the rule.
 */
export const selectKnowledgeBaseAvailable = (state: SettingsState): boolean =>
  state.advanced.developerMode;

/**
 * Is the Knowledge Base reachable here? Developer Mode only — see the module
 * header for why the feature cannot work in a packaged build at all.
 */
export function knowledgeBaseAvailableHere(): boolean {
  return selectKnowledgeBaseAvailable(useSettingsStore.getState());
}
