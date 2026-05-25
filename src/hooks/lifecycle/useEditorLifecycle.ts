/**
 * useEditorLifecycle — editor-shortcut + menu-event composite (T03).
 *
 * Bundles the menu-event listeners + keyboard-shortcut wiring + the
 * format-upgrade nudge. After T06 lands, the six legacy
 * use*MenuEvents hooks are deleted and useUnifiedMenuCommands stands
 * alone here.
 *
 * Order contract: menu event hooks register first (so they're listening
 * before any shortcut hook can fire a synthetic event); search /
 * shortcut hooks follow; the upgrade nudge is last (visual toast).
 *
 *   menu events (6) → useSearchCommands → useViewShortcuts
 *   → useTabShortcuts → useFileExplorerShortcuts → useUniversalToolbar
 *   → useFormatsUpgradeNudge
 *
 * Called unconditionally from MainLayout.
 *
 * @module hooks/lifecycle/useEditorLifecycle
 */

import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useViewMenuEvents } from "@/hooks/useViewMenuEvents";
import { useRecentFilesMenuEvents } from "@/hooks/useRecentFilesMenuEvents";
import { useExportMenuEvents } from "@/hooks/useExportMenuEvents";
import { useWorkspaceMenuEvents } from "@/hooks/useWorkspaceMenuEvents";
import { useRecentWorkspacesMenuEvents } from "@/hooks/useRecentWorkspacesMenuEvents";
import { useSearchCommands } from "@/hooks/useSearchCommands";
import { useViewShortcuts } from "@/hooks/useViewShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useFileExplorerShortcuts } from "@/hooks/useFileExplorerShortcuts";
import { useUniversalToolbar } from "@/hooks/useUniversalToolbar";
import { useFormatsUpgradeNudge } from "@/hooks/useFormatsUpgradeNudge";

export function useEditorLifecycle(): void {
  useMenuEvents();
  useViewMenuEvents();
  useRecentFilesMenuEvents();
  useExportMenuEvents();
  useWorkspaceMenuEvents();
  useRecentWorkspacesMenuEvents();
  useSearchCommands();
  useViewShortcuts();
  useTabShortcuts();
  useFileExplorerShortcuts();
  useUniversalToolbar();
  useFormatsUpgradeNudge();
}
