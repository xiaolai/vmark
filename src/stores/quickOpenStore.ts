import { create } from "zustand";

interface QuickOpenState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** Store managing Quick Open overlay visibility. */
export const useQuickOpenStore = create<QuickOpenState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}));
