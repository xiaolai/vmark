/**
 * Genie Picker Store — AI genie picker popup state machine.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/geniePickerStore
 */

import { create } from "zustand";
import type { GenieScope } from "@/types/aiGenies";

export type PickerMode = "search" | "freeform" | "processing" | "preview" | "error";

interface GeniePickerData {
  isOpen: boolean;
  filterScope: GenieScope | null;
  mode: PickerMode;
  submittedPrompt: string | null;
  responseText: string;
  pickerError: string | null;
}

interface GeniePickerState extends GeniePickerData {
  /**
   * `filterScope` is `| undefined` because callers pass the result of
   * `detectScope()`, whose "no scope" answer IS undefined; the implementation
   * normalises it to `null` on the way in.
   */
  openPicker: (options?: { filterScope?: GenieScope | undefined }) => void;
  closePicker: () => void;
  setMode: (mode: PickerMode) => void;
  startProcessing: (prompt: string) => void;
  appendResponse: (chunk: string) => void;
  setPreview: (fullText: string) => void;
  setPickerError: (message: string) => void;
  resetToInput: () => void;
}

const initialState: GeniePickerData = {
  isOpen: false,
  filterScope: null,
  mode: "search",
  submittedPrompt: null,
  responseText: "",
  pickerError: null,
};

export const useGeniePickerStore = create<GeniePickerState>((set) => ({
  ...initialState,
  openPicker: (options) =>
    set({
      ...initialState,
      isOpen: true,
      filterScope: options?.filterScope ?? null,
    }),
  closePicker: () => set(initialState),
  setMode: (mode) => set({ mode }),
  startProcessing: (prompt) =>
    set({
      mode: "processing",
      submittedPrompt: prompt,
      responseText: "",
      pickerError: null,
    }),
  appendResponse: (chunk) =>
    set((s) => ({ responseText: s.responseText + chunk })),
  setPreview: (fullText) => set({ mode: "preview", responseText: fullText }),
  setPickerError: (message) => set({ mode: "error", pickerError: message }),
  resetToInput: () =>
    set({
      mode: "search",
      submittedPrompt: null,
      responseText: "",
      pickerError: null,
    }),
}));
