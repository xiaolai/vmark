/**
 * Genie Picker Store
 *
 * Purpose: Minimal open/close state for the AI genie picker overlay,
 *   with optional scope filter to limit visible genies.
 *
 * @module stores/geniePickerStore
 */

import { create } from "zustand";
import type { GenieScope } from "@/types/aiGenies";

interface GeniePickerState {
  isOpen: boolean;
  filterScope: GenieScope | null;
}

interface GeniePickerActions {
  openPicker(options?: { filterScope?: GenieScope }): void;
  closePicker(): void;
}

const initialState: GeniePickerState = {
  isOpen: false,
  filterScope: null,
};

export const useGeniePickerStore = create<
  GeniePickerState & GeniePickerActions
>((set) => ({
  ...initialState,

  openPicker: (options) =>
    set({
      isOpen: true,
      filterScope: options?.filterScope ?? null,
    }),

  closePicker: () => set(initialState),
}));
