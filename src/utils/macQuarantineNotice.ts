/**
 * macOS Quarantine Auto-Strip Notice
 *
 * Purpose: Best-effort strip of `com.apple.quarantine` from a workspace root
 *   and its direct .md children. Without this, files saved by apps like
 *   Mixin Messenger fail to open in a running VMark via Finder double-click —
 *   macOS Launch Services routes them through CoreServicesUIAgent, which
 *   silently drops the openURLs delivery to running Tauri apps.
 *
 * Pipeline: openWorkspaceWithConfig → maybeStripQuarantine →
 *   strip_workspace_quarantine_cmd (Rust) → optional one-time toast.
 *
 * Key decisions:
 *   - macOS only — no-ops on other platforms (the Rust command is also a
 *     no-op on non-macOS, but bailing here avoids the round-trip).
 *   - Setting-gated: respects `advanced.clearMacQuarantineOnOpen` toggle.
 *   - Fire-and-forget: callers don't await; failures are logged, never
 *     surfaced as errors. Workspace open must succeed even if strip fails.
 *   - One-time toast: first time the strip actually clears anything (count > 0),
 *     show a pinned toast explaining what happened. After that, silent.
 *     Persistence via localStorage so the notice doesn't re-appear after a
 *     restart, and isn't tied to settings persistence (which the user might
 *     reset).
 *
 * @coordinates-with src-tauri/src/quarantine.rs — strip_workspace_quarantine_cmd
 * @module utils/macQuarantineNotice
 */

import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { useSettingsStore } from "@/stores/settingsStore";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { workspaceError } from "@/utils/debug";

export interface QuarantineStripStats {
  stripped_count: number;
  error_count: number;
}

const NOTICE_FLAG_KEY = "vmark-mac-quarantine-notice-shown";

/** Has the one-time toast already been shown on this machine? */
function hasShownNotice(): boolean {
  try {
    return globalThis.localStorage?.getItem(NOTICE_FLAG_KEY) === "1";
  } catch {
    // localStorage unavailable (private mode, sandbox) — treat as shown so
    // we don't pester users with a toast we can't suppress later.
    return true;
  }
}

function markNoticeShown(): void {
  try {
    globalThis.localStorage?.setItem(NOTICE_FLAG_KEY, "1");
  } catch {
    // Best-effort; ignore.
  }
}

/**
 * Best-effort strip of macOS quarantine on the workspace root and its direct
 * `.md` children. Safe to call on any platform — non-macOS bails immediately.
 *
 * Does not throw. Failures are logged via workspaceError.
 */
export async function maybeStripMacQuarantine(rootPath: string): Promise<void> {
  if (!isMacPlatform()) return;
  if (!useSettingsStore.getState().advanced.clearMacQuarantineOnOpen) return;
  if (!rootPath) return;

  let stats: QuarantineStripStats;
  try {
    stats = await invoke<QuarantineStripStats>("strip_workspace_quarantine_cmd", {
      root: rootPath,
    });
  } catch (error) {
    workspaceError("Failed to strip quarantine:", rootPath, error);
    return;
  }

  if (stats.stripped_count > 0 && !hasShownNotice()) {
    markNoticeShown();
    toast.info(
      i18n.t("dialog:toast.quarantineCleared", { count: stats.stripped_count }),
      {
        description: i18n.t("dialog:toast.quarantineClearedDesc"),
        pin: true,
      }
    );
  }
}
