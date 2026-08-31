/**
 * useVisibleTerminalSessions — React face of the ONE visibility rule
 * (WI-TS3.1, plan invariant 7).
 *
 * Purpose: subscribes to the three inputs of the visible population —
 * sessions, rail flag, active workspace instance — and derives the filtered
 * list through the same pure selector the imperative service uses.
 *
 * @coordinates-with services/terminal/visibleTerminalSessions.ts — imperative face
 * @coordinates-with TerminalTabBar.tsx, TerminalPanel.tsx — consumers
 * @module components/Terminal/useVisibleTerminalSessions
 */
import { useMemo } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { selectVisibleTerminalSessions } from "@/stores/uiStore/terminalScopeSelectors";
import type { TerminalSession } from "@/stores/uiStore/types";

/** The window's currently-visible terminal sessions, as reactive state. */
export function useVisibleTerminalSessions(): TerminalSession[] {
  const sessions = useUIStore((s) => s.terminal.sessions);
  const railEnabled = useSettingsStore(
    (s) => s.general?.workspaceRailMode ?? false,
  );
  const activeInstanceId = useWorkspaceInstancesStore(
    (s) => s.windows[getCurrentWindowLabel()]?.activeWorkspaceInstanceId ?? null,
  );
  return useMemo(
    () => selectVisibleTerminalSessions({ sessions }, activeInstanceId, railEnabled),
    [sessions, activeInstanceId, railEnabled],
  );
}
