/**
 * useEditorLifecycle — editor-shortcut + menu-event composite (T03/T06).
 *
 * Post-T06: every native menu event flows through the CommandBus via
 * `useCommandBootstrap()` — a single registration + listener mount.
 * The six legacy `use*MenuEvents` hooks were deleted in T06.
 *
 * Order contract: command bootstrap registers menu listeners first
 * (so they're listening before any shortcut hook fires a synthetic
 * event); search / shortcut hooks follow; the upgrade nudge is last
 * (visual toast).
 *
 *   useCommandBootstrap (menu→command) → useSearchCommands
 *   → useViewShortcuts → useTabShortcuts → useFileExplorerShortcuts
 *   → useUniversalToolbar → useFormatsUpgradeNudge
 *
 * Called unconditionally from MainLayout.
 *
 * @module hooks/lifecycle/useEditorLifecycle
 */

import { useCommandBootstrap } from "@/services/commands";
import { useSearchCommands } from "@/hooks/useSearchCommands";
import { useViewShortcuts } from "@/hooks/useViewShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useFileExplorerShortcuts } from "@/hooks/useFileExplorerShortcuts";
import { useUniversalToolbar } from "@/hooks/useUniversalToolbar";
import { useFormatsUpgradeNudge } from "@/hooks/useFormatsUpgradeNudge";
import { useMarkdownSplitDefault } from "@/hooks/useMarkdownSplitDefault";
import { useViewMenuStateSync } from "@/hooks/useViewMenuStateSync";

export function useEditorLifecycle(): void {
  useCommandBootstrap();
  useSearchCommands();
  useViewShortcuts();
  useTabShortcuts();
  useFileExplorerShortcuts();
  useUniversalToolbar();
  useFormatsUpgradeNudge();
  useMarkdownSplitDefault();
  useViewMenuStateSync();
}
