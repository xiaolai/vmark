/**
 * Tests for sourceWikiLinkActions — save, open, copy, remove operations.
 *
 * Tests buildWikiLinkMarkdown, findWikiLinkAtPos, resolveWikiLinkPath,
 * and all exported action functions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock dependencies
const mockClosePopup = vi.fn();
const mockUpdateTarget = vi.fn();
let wikiLinkStoreState = {
  isOpen: false,
  target: "",
  nodePos: null as number | null,
  anchorRect: null,
  closePopup: mockClosePopup,
  updateTarget: mockUpdateTarget,
};

vi.mock("@/stores/wikiLinkPopupStore", () => ({
  useWikiLinkPopupStore: {
    getState: () => wikiLinkStoreState,
    setState: (s: Partial<typeof wikiLinkStoreState>) => {
      wikiLinkStoreState = { ...wikiLinkStoreState, ...s };
    },
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: "/workspace" }),
  },
}));

const mockWriteText = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => mockWriteText(...args),
}));

const mockEmit = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    emit: mockEmit,
  }),
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: (_view: unknown, fn: () => void) => fn(),
}));

vi.mock("@/utils/debug", () => ({
  sourcePopupWarn: vi.fn(),
  sourceActionError: vi.fn(),
}));

import { sourceActionError } from "@/utils/debug";
import {
  saveWikiLinkChanges,
  openWikiLink,
  copyWikiLinkTarget,
  removeWikiLink,
} from "./sourceWikiLinkActions";

// Helper to create a CM6 view
function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("saveWikiLinkChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wikiLinkStoreState = {
      isOpen: true,
      target: "NewTarget",
      nodePos: 0,
      anchorRect: null,
      closePopup: mockClosePopup,
      updateTarget: mockUpdateTarget,
    };
  });

  it("replaces wiki link target in document", () => {
    const view = createView("[[OldTarget]]");
    wikiLinkStoreState.target = "NewTarget";
    wikiLinkStoreState.nodePos = 2; // Inside [[OldTarget]]

    saveWikiLinkChanges(view);

    expect(view.state.doc.toString()).toBe("[[NewTarget]]");
    view.destroy();
  });

  it("preserves alias when updating target", () => {
    const view = createView("[[OldTarget|Display Text]]");
    wikiLinkStoreState.target = "NewTarget";
    wikiLinkStoreState.nodePos = 5;

    saveWikiLinkChanges(view);

    // When alias equals the old alias (not matching new target), alias is preserved
    expect(view.state.doc.toString()).toBe("[[NewTarget|Display Text]]");
    view.destroy();
  });

  it("does nothing when nodePos is null", () => {
    const doc = "[[Target]]";
    const view = createView(doc);
    wikiLinkStoreState.nodePos = null;

    saveWikiLinkChanges(view);

    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("does nothing when no wiki link found at nodePos", () => {
    const doc = "No wiki links here";
    const view = createView(doc);
    wikiLinkStoreState.nodePos = 5;

    saveWikiLinkChanges(view);

    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("generates simple syntax when target matches alias", () => {
    const view = createView("[[Page|Page]]");
    wikiLinkStoreState.target = "Page";
    wikiLinkStoreState.nodePos = 3;

    saveWikiLinkChanges(view);

    // When alias equals target, it should simplify to [[target]]
    expect(view.state.doc.toString()).toBe("[[Page]]");
    view.destroy();
  });
});

describe("openWikiLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wikiLinkStoreState = {
      isOpen: true,
      target: "MyPage",
      nodePos: 0,
      anchorRect: null,
      closePopup: mockClosePopup,
      updateTarget: mockUpdateTarget,
    };
  });

  it("emits open-file event with resolved path", async () => {
    wikiLinkStoreState.target = "MyPage";

    await openWikiLink();

    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/workspace/MyPage.md",
      windowLabel: "main",
    });
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("resolves paths with .md extension", async () => {
    wikiLinkStoreState.target = "docs/readme.md";

    await openWikiLink();

    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/workspace/docs/readme.md",
      windowLabel: "main",
    });
  });

  it("appends .md to targets without extension", async () => {
    wikiLinkStoreState.target = "docs/readme";

    await openWikiLink();

    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/workspace/docs/readme.md",
      windowLabel: "main",
    });
  });

  it("does nothing when target is empty", async () => {
    wikiLinkStoreState.target = "";

    await openWikiLink();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("handles emit error gracefully", async () => {
    mockEmit.mockRejectedValueOnce(new Error("emit failed"));
    
    wikiLinkStoreState.target = "Page";

    await openWikiLink();

    expect(sourceActionError).toHaveBeenCalled();
  });
});

describe("copyWikiLinkTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies target to clipboard", async () => {
    wikiLinkStoreState.target = "MyPage";

    await copyWikiLinkTarget();

    expect(mockWriteText).toHaveBeenCalledWith("MyPage");
  });

  it("does nothing when target is empty", async () => {
    wikiLinkStoreState.target = "";

    await copyWikiLinkTarget();

    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("handles clipboard error gracefully", async () => {
    mockWriteText.mockRejectedValueOnce(new Error("clipboard failed"));
    
    wikiLinkStoreState.target = "Page";

    await copyWikiLinkTarget();

    expect(sourceActionError).toHaveBeenCalled();
  });
});

describe("removeWikiLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wikiLinkStoreState = {
      isOpen: true,
      target: "Target",
      nodePos: 0,
      anchorRect: null,
      closePopup: mockClosePopup,
      updateTarget: mockUpdateTarget,
    };
  });

  it("replaces wiki link with target text", () => {
    const view = createView("See [[Target]] here");
    wikiLinkStoreState.nodePos = 6; // Inside [[Target]]

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe("See Target here");
    view.destroy();
  });

  it("replaces wiki link with alias when present", () => {
    const view = createView("See [[Target|Display]] here");
    wikiLinkStoreState.nodePos = 6;

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe("See Display here");
    view.destroy();
  });

  it("does nothing when nodePos is null", () => {
    const doc = "See [[Target]] here";
    const view = createView(doc);
    wikiLinkStoreState.nodePos = null;

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("does nothing when no wiki link found at nodePos", () => {
    const doc = "No wiki links here";
    const view = createView(doc);
    wikiLinkStoreState.nodePos = 5;

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("handles wiki link at start of document", () => {
    const view = createView("[[Start]] end");
    wikiLinkStoreState.nodePos = 3;

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe("Start end");
    view.destroy();
  });

  it("handles wiki link at end of document", () => {
    const view = createView("Start [[End]]");
    wikiLinkStoreState.nodePos = 9;

    removeWikiLink(view);

    expect(view.state.doc.toString()).toBe("Start End");
    view.destroy();
  });
});
