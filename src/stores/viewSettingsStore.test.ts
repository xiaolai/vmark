import { describe, it, expect, beforeEach } from "vitest";
import { useViewSettingsStore } from "./viewSettingsStore";

describe("viewSettingsStore", () => {
  beforeEach(() => {
    useViewSettingsStore.getState().reset();
  });

  it("has correct initial state", () => {
    const state = useViewSettingsStore.getState();

    expect(state.sourceMode).toBe(false);
    expect(state.focusModeEnabled).toBe(false);
    expect(state.typewriterModeEnabled).toBe(false);
    expect(state.wordWrap).toBe(true);
    expect(state.showLineNumbers).toBe(false);
    expect(state.diagramPreviewEnabled).toBe(false);
  });

  it("toggleSourceMode toggles source mode", () => {
    const { toggleSourceMode } = useViewSettingsStore.getState();

    expect(useViewSettingsStore.getState().sourceMode).toBe(false);

    toggleSourceMode();
    expect(useViewSettingsStore.getState().sourceMode).toBe(true);

    toggleSourceMode();
    expect(useViewSettingsStore.getState().sourceMode).toBe(false);
  });

  it("toggleFocusMode toggles focus mode", () => {
    const { toggleFocusMode } = useViewSettingsStore.getState();

    expect(useViewSettingsStore.getState().focusModeEnabled).toBe(false);

    toggleFocusMode();
    expect(useViewSettingsStore.getState().focusModeEnabled).toBe(true);

    toggleFocusMode();
    expect(useViewSettingsStore.getState().focusModeEnabled).toBe(false);
  });

  it("toggleTypewriterMode toggles typewriter mode", () => {
    const { toggleTypewriterMode } = useViewSettingsStore.getState();

    expect(useViewSettingsStore.getState().typewriterModeEnabled).toBe(false);

    toggleTypewriterMode();
    expect(useViewSettingsStore.getState().typewriterModeEnabled).toBe(true);

    toggleTypewriterMode();
    expect(useViewSettingsStore.getState().typewriterModeEnabled).toBe(false);
  });

  it("toggleWordWrap toggles word wrap", () => {
    const { toggleWordWrap } = useViewSettingsStore.getState();

    // Default is true
    expect(useViewSettingsStore.getState().wordWrap).toBe(true);

    toggleWordWrap();
    expect(useViewSettingsStore.getState().wordWrap).toBe(false);

    toggleWordWrap();
    expect(useViewSettingsStore.getState().wordWrap).toBe(true);
  });

  it("toggleLineNumbers toggles line numbers", () => {
    const { toggleLineNumbers } = useViewSettingsStore.getState();

    expect(useViewSettingsStore.getState().showLineNumbers).toBe(false);

    toggleLineNumbers();
    expect(useViewSettingsStore.getState().showLineNumbers).toBe(true);

    toggleLineNumbers();
    expect(useViewSettingsStore.getState().showLineNumbers).toBe(false);
  });

  it("toggleDiagramPreview toggles diagram preview", () => {
    const { toggleDiagramPreview } = useViewSettingsStore.getState();

    expect(useViewSettingsStore.getState().diagramPreviewEnabled).toBe(false);

    toggleDiagramPreview();
    expect(useViewSettingsStore.getState().diagramPreviewEnabled).toBe(true);

    toggleDiagramPreview();
    expect(useViewSettingsStore.getState().diagramPreviewEnabled).toBe(false);
  });

  it("reset restores initial state", () => {
    const { toggleSourceMode, toggleFocusMode, toggleWordWrap, reset } =
      useViewSettingsStore.getState();

    toggleSourceMode();
    toggleFocusMode();
    toggleWordWrap(); // false now

    reset();

    const state = useViewSettingsStore.getState();
    expect(state.sourceMode).toBe(false);
    expect(state.focusModeEnabled).toBe(false);
    expect(state.wordWrap).toBe(true);
  });

  it("setSourceMode sets source mode directly", () => {
    const { setSourceMode } = useViewSettingsStore.getState();

    setSourceMode(true);
    expect(useViewSettingsStore.getState().sourceMode).toBe(true);

    setSourceMode(false);
    expect(useViewSettingsStore.getState().sourceMode).toBe(false);
  });

  it("setFocusModeEnabled sets focus mode directly", () => {
    const { setFocusModeEnabled } = useViewSettingsStore.getState();

    setFocusModeEnabled(true);
    expect(useViewSettingsStore.getState().focusModeEnabled).toBe(true);

    setFocusModeEnabled(false);
    expect(useViewSettingsStore.getState().focusModeEnabled).toBe(false);
  });

  it("setTypewriterModeEnabled sets typewriter mode directly", () => {
    const { setTypewriterModeEnabled } = useViewSettingsStore.getState();

    setTypewriterModeEnabled(true);
    expect(useViewSettingsStore.getState().typewriterModeEnabled).toBe(true);

    setTypewriterModeEnabled(false);
    expect(useViewSettingsStore.getState().typewriterModeEnabled).toBe(false);
  });
});
