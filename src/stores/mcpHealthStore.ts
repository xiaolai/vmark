/**
 * MCP Health Store
 *
 * Stores MCP server health information including tool count, version,
 * and connection diagnostics. Shared across StatusBar, Settings, and dialogs.
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
  dialogOpen: boolean;

  // Actions
  setHealth: (health: Partial<McpHealthInfo>) => void;
  setIsChecking: (checking: boolean) => void;
  openDialog: () => void;
  closeDialog: () => void;
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
  dialogOpen: false,

  setHealth: (health) =>
    set((state) => ({
      health: { ...state.health, ...health },
    })),

  setIsChecking: (isChecking) => set({ isChecking }),

  openDialog: () => set({ dialogOpen: true }),

  closeDialog: () => set({ dialogOpen: false }),

  reset: () => set({ health: initialHealth, isChecking: false }),
}));
