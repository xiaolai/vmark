/**
 * commandPaletteStore — open/close state for the ADR-012 command palette.
 *
 * Intentionally tiny: any caller (keyboard shortcut, status-bar button,
 * programmatic API) can call `useCommandPaletteStore.getState().open()`.
 *
 * @module components/CommandPalette/commandPaletteStore
 */

import { create } from "zustand";

interface CommandPaletteState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
