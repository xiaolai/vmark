/**
 * useWorkspaceLifecycle — workspace + cross-window-sync composite (T03).
 *
 * Bundles workspace bootstrap + the cross-window settings/format
 * synchronization hooks that need to run in every routed window.
 *
 * Order contract: `useWorkspaceBootstrap` MUST run first (loads
 * persisted workspace config from disk so downstream stores see the
 * correct initial state).
 *
 *   useWorkspaceBootstrap → useSettingsSync → useConfirmQuitSync
 *   → useRecentFilesSync → useRecentWorkspacesSync
 *   → useFormatSettingsBridge
 *
 * Called unconditionally from MainLayout — safe in non-document
 * windows; each underlying hook tolerates "no active document."
 *
 * @module hooks/lifecycle/useWorkspaceLifecycle
 */

import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useConfirmQuitSync } from "@/hooks/useConfirmQuitSync";
import { useRecentFilesSync } from "@/hooks/useRecentFilesSync";
import { useRecentWorkspacesSync } from "@/hooks/useRecentWorkspacesSync";
import { useFormatSettingsBridge } from "@/services/formats/formatSettingsBridge";

export function useWorkspaceLifecycle(): void {
  useWorkspaceBootstrap();
  useSettingsSync();
  useConfirmQuitSync();
  useRecentFilesSync();
  useRecentWorkspacesSync();
  useFormatSettingsBridge();
}
