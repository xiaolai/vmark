/**
 * MCP Health Store
 *
 * Purpose: Stores MCP server health diagnostics — version, tool/resource counts,
 *   last check time, and error state. Shared between StatusBar (tooltip) and
 *   Settings (MCP status dialog).
 *
 * Pipeline: useMcpHealthCheck hook polls server → setHealth() updates state →
 *   StatusBar and Settings read reactively.
 *
 * @coordinates-with useMcpHealthCheck.ts — performs health check polling
 * @coordinates-with StatusBar component — shows MCP status indicator
 * @module stores/mcpHealthStore
 */

import { create } from "zustand";

export interface McpHealthInfo {
  version: string | null;
  toolCount: number | null;
  resourceCount: number | null;
  tools: string[];
  lastChecked: Date | null;
  checkError: string | null;
}

interface McpHealthState {
  health: McpHealthInfo;
  isChecking: boolean;

  // Actions
  setHealth: (health: Partial<McpHealthInfo>) => void;
  setIsChecking: (checking: boolean) => void;
  reset: () => void;
}

const initialHealth: McpHealthInfo = {
  version: null,
  toolCount: null,
  resourceCount: null,
  tools: [],
  lastChecked: null,
  checkError: null,
};

export const useMcpHealthStore = create<McpHealthState>((set) => ({
  health: initialHealth,
  isChecking: false,

  setHealth: (health) =>
    set((state) => ({
      health: { ...state.health, ...health },
    })),

  setIsChecking: (isChecking) => set({ isChecking }),

  reset: () => set({ health: initialHealth, isChecking: false }),
}));
