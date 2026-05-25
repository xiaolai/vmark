/**
 * Tests for editorPlugins.tiptap — inner callback execution paths.
 * Covers the handler invocation when view IS provided (lines not reached
 * by the main test file which passes undefined view).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock all handler modules BEFORE importing the module under test
vi.mock("./editorPlugins/expandedToggleMark", () => ({
  expandedToggleMark: vi.fn(() => true),
}));
vi.mock("./editorPlugins/linkCommands", () => ({
  handleSmartLinkShortcut: vi.fn(() => true),
  handleUnlinkShortcut: vi.fn(() => true),
  handleWikiLinkShortcut: vi.fn(() => true),
}));
vi.mock("./editorPlugins/bookmarkLinkCommand", () => ({
  handleBookmarkLinkShortcut: vi.fn(() => true),
}));
vi.mock("./editorPlugins/inlineMathCommand", () => ({
  handleInlineMathShortcut: vi.fn(() => true),
}));
vi.mock("./editorPlugins/textTransformCommands", () => ({
  doWysiwygTransformUppercase: vi.fn(() => true),
  doWysiwygTransformLowercase: vi.fn(() => true),
  doWysiwygTransformTitleCase: vi.fn(() => true),
  doWysiwygTransformToggleCase: vi.fn(() => true),
}));
vi.mock("./editorPlugins/lineOperationCommands", () => ({
  doWysiwygMoveLineUp: vi.fn(() => true),
  doWysiwygMoveLineDown: vi.fn(() => true),
  doWysiwygDuplicateLine: vi.fn(() => true),
  doWysiwygDeleteLine: vi.fn(() => true),
  doWysiwygJoinLines: vi.fn(() => true),
}));
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  triggerPastePlainText: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/plugins/sourcePeekInline", () => ({
  openSourcePeekInline: vi.fn(() => true),
  revertAndCloseSourcePeek: vi.fn(),
}));
vi.mock("@/plugins/formatToolbar/nodeActions.tiptap", () => ({
  handleRemoveBlockquote: vi.fn(),
}));
vi.mock("@/hooks/useUnifiedHistory", () => ({
  performUnifiedUndo: vi.fn(() => true),
  performUnifiedRedo: vi.fn(() => true),
}));
vi.mock("./editorPlugins/keymapUtils", async () => {
  const actual = await vi.importActual<typeof import("./editorPlugins/keymapUtils")>("./editorPlugins/keymapUtils");
  return {
    ...actual,
    wrapWithMultiSelectionGuard: (_id: string, cmd: (...args: unknown[]) => boolean) => cmd,
  };
});

import { useShortcutsStore } from "@/stores/settingsStore";
import { buildEditorKeymapBindings } from "./editorPlugins.tiptap";
import { expandedToggleMark } from "./editorPlugins/expandedToggleMark";
import { handleSmartLinkShortcut, handleUnlinkShortcut, handleWikiLinkShortcut } from "./editorPlugins/linkCommands";
import { handleBookmarkLinkShortcut } from "./editorPlugins/bookmarkLinkCommand";
import { handleInlineMathShortcut } from "./editorPlugins/inlineMathCommand";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";
import {
  doWysiwygMoveLineUp, doWysiwygMoveLineDown, doWysiwygDuplicateLine,
  doWysiwygDeleteLine, doWysiwygJoinLines,
} from "./editorPlugins/lineOperationCommands";
import {
  doWysiwygTransformUppercase, doWysiwygTransformLowercase,
  doWysiwygTransformTitleCase, doWysiwygTransformToggleCase,
} from "./editorPlugins/textTransformCommands";

function resetShortcuts() {
  useShortcutsStore.setState({ customBindings: {} });
}

afterEach(() => {
  resetShortcuts();
  vi.clearAllMocks();
});

const mockView = { dom: document.createElement("div"), state: {}, dispatch: vi.fn(), focus: vi.fn() };

describe("buildEditorKeymapBindings callback execution with view", () => {
  it("inline mark formatting bindings call expandedToggleMark with view", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const markMap: Record<string, string> = {
      bold: "bold", italic: "italic", code: "code",
      strikethrough: "strike", underline: "underline",
      highlight: "highlight", subscript: "subscript", superscript: "superscript",
    };

    for (const [name, markName] of Object.entries(markMap)) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        vi.mocked(expandedToggleMark).mockClear();
        const result = bindings[key]({} as never, vi.fn(), mockView);
        expect(result).toBe(true);
        expect(expandedToggleMark).toHaveBeenCalledWith(mockView, markName);
      }
    }
  });

  it("link binding calls handleSmartLinkShortcut with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("link");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(handleSmartLinkShortcut).toHaveBeenCalledWith(mockView);
    }
  });

  it("unlink binding calls handleUnlinkShortcut with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("unlink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(handleUnlinkShortcut).toHaveBeenCalledWith(mockView);
    }
  });

  it("wikiLink binding calls handleWikiLinkShortcut with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("wikiLink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(handleWikiLinkShortcut).toHaveBeenCalledWith(mockView);
    }
  });

  it("bookmarkLink binding calls handleBookmarkLinkShortcut with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("bookmarkLink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(handleBookmarkLinkShortcut).toHaveBeenCalledWith(mockView);
    }
  });

  it("inlineMath binding calls handleInlineMathShortcut with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("inlineMath");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(handleInlineMathShortcut).toHaveBeenCalledWith(mockView);
    }
  });

  it("pastePlainText binding calls triggerPastePlainText with view", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("pastePlainText");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(triggerPastePlainText).toHaveBeenCalledWith(mockView);
    }
  });

  it("line operation bindings call their handlers with view", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const ops: Record<string, (...args: unknown[]) => unknown> = {
      moveLineUp: doWysiwygMoveLineUp,
      moveLineDown: doWysiwygMoveLineDown,
      duplicateLine: doWysiwygDuplicateLine,
      deleteLine: doWysiwygDeleteLine,
      joinLines: doWysiwygJoinLines,
    };

    for (const [name, handler] of Object.entries(ops)) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        const pmKey = key.replace(/\bUp\b/g, "ArrowUp").replace(/\bDown\b/g, "ArrowDown");
        if (bindings[pmKey]) {
          vi.mocked(handler).mockClear();
          const result = bindings[pmKey]({} as never, vi.fn(), mockView);
          expect(result).toBe(true);
          expect(handler).toHaveBeenCalledWith(mockView);
        }
      }
    }
  });

  it("text transform bindings call their handlers with view", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const transforms: Record<string, (...args: unknown[]) => unknown> = {
      transformUppercase: doWysiwygTransformUppercase,
      transformLowercase: doWysiwygTransformLowercase,
      transformTitleCase: doWysiwygTransformTitleCase,
      transformToggleCase: doWysiwygTransformToggleCase,
    };

    for (const [name, handler] of Object.entries(transforms)) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        vi.mocked(handler).mockClear();
        const result = bindings[key]({} as never, vi.fn(), mockView);
        expect(result).toBe(true);
        expect(handler).toHaveBeenCalledWith(mockView);
      }
    }
  });

  it("sourcePeek binding calls openSourcePeekInline when not open", async () => {
    const { useSourcePeekStore } = await import("@/stores/sourcePeekStore");
    useSourcePeekStore.setState({ isOpen: false });

    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("sourcePeek");
    if (key && bindings[key]) {
      const { openSourcePeekInline } = await import("@/plugins/sourcePeekInline");
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(openSourcePeekInline).toHaveBeenCalledWith(mockView);
    }
  });
});
