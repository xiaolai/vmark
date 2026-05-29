/**
 * MainWindowRunners — main-window-only lifecycle + shortcut runners (T03).
 *
 * Mounted only when `windowLabel === "main"`. Owns the main-window-
 * specific lifecycle hooks (MCP autostart, update checker, hot-exit
 * + crash-recovery startup, Finder file open) plus the shortcut
 * runner components that require conditional unmount (Genie picker,
 * Quick Open, Content Search, Command Palette).
 *
 * Order contract: `useHotExitStartup` MUST run before
 * `useFinderFileOpen` so the saved-session restore wins the race
 * against any pending Finder open event.
 *
 * Why runner components instead of a single composite: each shortcut
 * runner has its own keyboard event listener; unmounting them as a
 * group must be observable to React's reconciler so the listeners
 * detach cleanly. Inlining via a hook would couple the four runners'
 * lifetimes — undesirable.
 *
 * @module hooks/lifecycle/MainWindowRunners
 */

import { useMcpAutoStart } from "@/hooks/useMcpAutoStart";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { useUpdateBroadcast, useUpdateListener } from "@/hooks/useUpdateSync";
import { useResilienceStartup } from "@/services/persistence/resilience";
import { useHotExitCaptureWarning } from "@/services/persistence/hotExit/useHotExitCaptureWarning";
import { useFinderFileOpen } from "@/hooks/useFinderFileOpen";
import { useGenieShortcuts } from "@/hooks/useGenieShortcuts";
import { useQuickOpenShortcuts } from "@/hooks/useQuickOpenShortcuts";
import { useContentSearchShortcuts } from "@/components/ContentSearch/useContentSearchShortcuts";
import { useCommandPaletteShortcut } from "@/components/CommandPalette";

function MainWindowLifecycle(): null {
  useMcpAutoStart();
  useUpdateChecker();
  useUpdateBroadcast();
  useUpdateListener();
  // T07: main-window-only startup sequence (hot-exit session check +
  // crash-recovery scan). useResilienceStartup enforces the
  // hot-exit-before-crash-recovery order internally.
  useResilienceStartup();
  // Warn the user if hot-exit capture dropped any window (#969).
  useHotExitCaptureWarning();
  useFinderFileOpen();
  return null;
}

function GenieShortcutsRunner(): null {
  useGenieShortcuts();
  return null;
}

function QuickOpenShortcutsRunner(): null {
  useQuickOpenShortcuts();
  return null;
}

function ContentSearchShortcutsRunner(): null {
  useContentSearchShortcuts();
  return null;
}

function CommandPaletteShortcutRunner(): null {
  useCommandPaletteShortcut();
  return null;
}

export function MainWindowRunners(): React.ReactElement {
  return (
    <>
      <MainWindowLifecycle />
      <GenieShortcutsRunner />
      <QuickOpenShortcutsRunner />
      <ContentSearchShortcutsRunner />
      <CommandPaletteShortcutRunner />
    </>
  );
}
