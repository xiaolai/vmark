import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  it("has correct initial state", () => {
    const state = useEditorStore.getState();

    expect(state.content).toBe("");
    expect(state.filePath).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.focusModeEnabled).toBe(false);
    expect(state.typewriterModeEnabled).toBe(false);
  });

  it("setContent updates content and marks dirty", () => {
    const { setContent } = useEditorStore.getState();

    setContent("# Hello World");

    const state = useEditorStore.getState();
    expect(state.content).toBe("# Hello World");
    expect(state.isDirty).toBe(true);
  });

  it("setFilePath updates the file path", () => {
    const { setFilePath } = useEditorStore.getState();

    setFilePath("/path/to/file.md");

    expect(useEditorStore.getState().filePath).toBe("/path/to/file.md");
  });

  it("loadContent sets content without marking dirty", () => {
    const { loadContent } = useEditorStore.getState();

    loadContent("# Loaded Content");

    const state = useEditorStore.getState();
    expect(state.content).toBe("# Loaded Content");
    expect(state.isDirty).toBe(false);
  });

  it("loadContent sets content and filePath together", () => {
    const { loadContent } = useEditorStore.getState();

    loadContent("# File Content", "/path/to/doc.md");

    const state = useEditorStore.getState();
    expect(state.content).toBe("# File Content");
    expect(state.filePath).toBe("/path/to/doc.md");
    expect(state.isDirty).toBe(false);
  });

  it("markSaved clears the dirty flag", () => {
    const { setContent, markSaved } = useEditorStore.getState();

    setContent("Some content");
    expect(useEditorStore.getState().isDirty).toBe(true);

    markSaved();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("toggleFocusMode toggles focus mode", () => {
    const { toggleFocusMode } = useEditorStore.getState();

    expect(useEditorStore.getState().focusModeEnabled).toBe(false);

    toggleFocusMode();
    expect(useEditorStore.getState().focusModeEnabled).toBe(true);

    toggleFocusMode();
    expect(useEditorStore.getState().focusModeEnabled).toBe(false);
  });

  it("toggleTypewriterMode toggles typewriter mode", () => {
    const { toggleTypewriterMode } = useEditorStore.getState();

    expect(useEditorStore.getState().typewriterModeEnabled).toBe(false);

    toggleTypewriterMode();
    expect(useEditorStore.getState().typewriterModeEnabled).toBe(true);

    toggleTypewriterMode();
    expect(useEditorStore.getState().typewriterModeEnabled).toBe(false);
  });

  it("reset restores initial state", () => {
    const { setContent, setFilePath, toggleFocusMode, reset } =
      useEditorStore.getState();

    setContent("Modified content");
    setFilePath("/some/path.md");
    toggleFocusMode();

    reset();

    const state = useEditorStore.getState();
    expect(state.content).toBe("");
    expect(state.filePath).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.focusModeEnabled).toBe(false);
  });
});
