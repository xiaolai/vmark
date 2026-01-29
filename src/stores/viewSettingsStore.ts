import { create } from "zustand";

/**
 * Global view settings store.
 *
 * These settings control how the editor renders content and are shared
 * across all tabs/windows. They are NOT per-document settings.
 *
 * This store replaces the view-related state from the legacy editorStore.
 */

interface ViewSettingsState {
  /** WYSIWYG (false) vs source/markdown mode (true) */
  sourceMode: boolean;
  /** Highlight only the current paragraph */
  focusModeEnabled: boolean;
  /** Keep cursor vertically centered while typing */
  typewriterModeEnabled: boolean;
  /** Wrap long lines in source mode */
  wordWrap: boolean;
  /** Show line numbers in code blocks */
  showLineNumbers: boolean;
  /** Show diagram preview (mermaid, etc.) in source mode */
  diagramPreviewEnabled: boolean;
}

interface ViewSettingsActions {
  toggleSourceMode: () => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  toggleWordWrap: () => void;
  toggleLineNumbers: () => void;
  toggleDiagramPreview: () => void;
  setSourceMode: (enabled: boolean) => void;
  setFocusModeEnabled: (enabled: boolean) => void;
  setTypewriterModeEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState: ViewSettingsState = {
  sourceMode: false,
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  wordWrap: true,
  showLineNumbers: false,
  diagramPreviewEnabled: false,
};

export const useViewSettingsStore = create<ViewSettingsState & ViewSettingsActions>((set) => ({
  ...initialState,

  toggleSourceMode: () =>
    set((state) => ({ sourceMode: !state.sourceMode })),

  toggleFocusMode: () =>
    set((state) => ({ focusModeEnabled: !state.focusModeEnabled })),

  toggleTypewriterMode: () =>
    set((state) => ({ typewriterModeEnabled: !state.typewriterModeEnabled })),

  toggleWordWrap: () =>
    set((state) => ({ wordWrap: !state.wordWrap })),

  toggleLineNumbers: () =>
    set((state) => ({ showLineNumbers: !state.showLineNumbers })),

  toggleDiagramPreview: () =>
    set((state) => ({ diagramPreviewEnabled: !state.diagramPreviewEnabled })),

  setSourceMode: (enabled) => set({ sourceMode: enabled }),

  setFocusModeEnabled: (enabled) => set({ focusModeEnabled: enabled }),

  setTypewriterModeEnabled: (enabled) => set({ typewriterModeEnabled: enabled }),

  reset: () => set(initialState),
}));
