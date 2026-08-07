// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useSourcePeekStore } from "../sourcePeekStore";

beforeEach(() => {
  useSourcePeekStore.getState().close();
});

const samplePayload = {
  markdown: "# Hello\n\nWorld",
  range: { from: 0, to: 20 },
};

describe("sourcePeekStore", () => {
  describe("open", () => {
    it("sets isOpen and stores markdown as checkpoint", () => {
      useSourcePeekStore.getState().open(samplePayload);
      const state = useSourcePeekStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.markdown).toBe("# Hello\n\nWorld");
      expect(state.originalMarkdown).toBe("# Hello\n\nWorld");
      expect(state.hasUnsavedChanges).toBe(false);
    });

    it("sets range and editingPos from range.from", () => {
      useSourcePeekStore.getState().open(samplePayload);
      expect(useSourcePeekStore.getState().range).toEqual({ from: 0, to: 20 });
      expect(useSourcePeekStore.getState().editingPos).toBe(0);
    });

    it("sets optional blockTypeName", () => {
      useSourcePeekStore.getState().open({ ...samplePayload, blockTypeName: "heading" });
      expect(useSourcePeekStore.getState().blockTypeName).toBe("heading");
    });

    it("defaults blockTypeName to null", () => {
      useSourcePeekStore.getState().open(samplePayload);
      expect(useSourcePeekStore.getState().blockTypeName).toBeNull();
    });

    it("clears any previous parseError", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setParseError("some error");
      useSourcePeekStore.getState().open(samplePayload);
      expect(useSourcePeekStore.getState().parseError).toBeNull();
    });
  });

  describe("close", () => {
    it("resets to initial state", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("changed");
      useSourcePeekStore.getState().close();

      const state = useSourcePeekStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.markdown).toBe("");
      expect(state.originalMarkdown).toBeNull();
      expect(state.hasUnsavedChanges).toBe(false);
      expect(state.range).toBeNull();
    });
  });

  describe("setMarkdown", () => {
    it("tracks unsaved changes when different from original", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("changed content");
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(true);
      expect(useSourcePeekStore.getState().markdown).toBe("changed content");
    });

    it("clears unsaved flag when content matches original", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("changed");
      useSourcePeekStore.getState().setMarkdown("# Hello\n\nWorld");
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(false);
    });

    it("clears parseError on content change", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setParseError("bad markdown");
      useSourcePeekStore.getState().setMarkdown("fixed content");
      expect(useSourcePeekStore.getState().parseError).toBeNull();
    });
  });

  describe("toggleLivePreview", () => {
    it("toggles livePreview on and off", () => {
      expect(useSourcePeekStore.getState().livePreview).toBe(false);
      useSourcePeekStore.getState().toggleLivePreview();
      expect(useSourcePeekStore.getState().livePreview).toBe(true);
      useSourcePeekStore.getState().toggleLivePreview();
      expect(useSourcePeekStore.getState().livePreview).toBe(false);
    });
  });

  describe("markSaved", () => {
    it("clears hasUnsavedChanges", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("changed");
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(true);
      useSourcePeekStore.getState().markSaved();
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(false);
    });

    it("rebaselines the dirty check: re-entering the saved content stays clean", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("saved version");
      useSourcePeekStore.getState().markSaved();
      // Editing back to the exact just-saved content is NOT an unsaved change.
      useSourcePeekStore.getState().setMarkdown("saved version");
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(false);
    });

    it("rebaselines the dirty check: editing back to the pre-save original is dirty", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("saved version");
      useSourcePeekStore.getState().markSaved();
      // The pre-save text now differs from the saved baseline -> unsaved change.
      useSourcePeekStore.getState().setMarkdown("# Hello\n\nWorld");
      expect(useSourcePeekStore.getState().hasUnsavedChanges).toBe(true);
    });

    it("preserves getOriginalMarkdown as the true original after save (revert target)", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("saved version");
      useSourcePeekStore.getState().markSaved();
      expect(useSourcePeekStore.getState().getOriginalMarkdown()).toBe(
        "# Hello\n\nWorld",
      );
    });
  });

  describe("getOriginalMarkdown", () => {
    it("returns original markdown after open", () => {
      useSourcePeekStore.getState().open(samplePayload);
      expect(useSourcePeekStore.getState().getOriginalMarkdown()).toBe("# Hello\n\nWorld");
    });

    it("returns null when not open", () => {
      expect(useSourcePeekStore.getState().getOriginalMarkdown()).toBeNull();
    });
  });

  describe("setParseError", () => {
    it("sets and clears parse error", () => {
      useSourcePeekStore.getState().setParseError("Parse failed");
      expect(useSourcePeekStore.getState().parseError).toBe("Parse failed");
      useSourcePeekStore.getState().setParseError(null);
      expect(useSourcePeekStore.getState().parseError).toBeNull();
    });
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("sourcePeekStore — T09 revert contract pins", () => {
  const initialData = {
    isOpen: false,
    editingPos: null,
    range: null,
    markdown: "",
    originalMarkdown: null,
    savedMarkdown: null,
    livePreview: false,
    parseError: null,
    hasUnsavedChanges: false,
    blockTypeName: null,
  };

  function dataOf(s: ReturnType<typeof useSourcePeekStore.getState>) {
    const {
      isOpen, editingPos, range, markdown, originalMarkdown, savedMarkdown,
      livePreview, parseError, hasUnsavedChanges, blockTypeName,
    } = s;
    return {
      isOpen, editingPos, range, markdown, originalMarkdown, savedMarkdown,
      livePreview, parseError, hasUnsavedChanges, blockTypeName,
    };
  }

  it("no leak across sessions: edit + save in A → close → open B is a fresh baseline", () => {
    useSourcePeekStore.getState().open(samplePayload);
    useSourcePeekStore.getState().setMarkdown("A edited");
    useSourcePeekStore.getState().markSaved();
    useSourcePeekStore.getState().close();

    useSourcePeekStore.getState().open({
      markdown: "B content",
      range: { from: 5, to: 9 },
      blockTypeName: "paragraph",
    });

    expect(dataOf(useSourcePeekStore.getState())).toEqual({
      ...initialData,
      isOpen: true,
      editingPos: 5,
      range: { from: 5, to: 9 },
      markdown: "B content",
      originalMarkdown: "B content",
      savedMarkdown: "B content",
      blockTypeName: "paragraph",
    });
  });

  it("setMarkdown while closed still mutates and reads dirty against a null baseline (pinned legacy behavior)", () => {
    useSourcePeekStore.getState().setMarkdown("closed edit");
    const state = useSourcePeekStore.getState();
    expect(state.markdown).toBe("closed edit");
    expect(state.hasUnsavedChanges).toBe(true);
    expect(state.isOpen).toBe(false);
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useSourcePeekStore.getState().open({ markdown: `m${i}`, range: { from: i, to: i + 1 } });
      useSourcePeekStore.getState().close();
    }
    expect(dataOf(useSourcePeekStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.getState().setMarkdown("mutated");
      expect(dataOf(useSourcePeekStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useSourcePeekStore.getState().open(samplePayload);
      useSourcePeekStore.setState(useSourcePeekStore.getInitialState());
      expect(dataOf(useSourcePeekStore.getState())).toEqual(initialData);
    });
  });
});
