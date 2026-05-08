/**
 * sourceEditorExtensions tests
 *
 * Tests createSourceEditorExtensions and exported compartments.
 */

import { describe, it, expect, vi } from "vitest";

// --- Mocks ---

vi.mock("@codemirror/state", () => {
  class MockCompartment {
    of = vi.fn((ext: unknown) => ext);
    reconfigure = vi.fn((ext: unknown) => ext);
  }
  return {
    Compartment: MockCompartment,
    EditorState: {
      allowMultipleSelections: { of: vi.fn(() => "allow-multi") },
      readOnly: { of: vi.fn(() => "readOnly") },
    },
  };
});

vi.mock("@codemirror/view", () => ({
  EditorView: {
    lineWrapping: "lineWrapping",
    updateListener: { of: vi.fn((cb: unknown) => cb) },
    theme: vi.fn(() => "theme"),
    baseTheme: vi.fn(() => "baseTheme"),
  },
  keymap: { of: vi.fn((keys: unknown) => keys) },
  drawSelection: vi.fn(() => "drawSelection"),
  dropCursor: vi.fn(() => "dropCursor"),
  lineNumbers: vi.fn(() => "lineNumbers"),
  ViewPlugin: { fromClass: vi.fn(() => "ViewPlugin") },
}));

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => "history"),
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => "markdown-lang"),
  markdownLanguage: { data: { of: vi.fn(() => "md-brackets") } },
}));

vi.mock("@codemirror/language-data", () => ({
  languages: [],
}));

vi.mock("@codemirror/language", () => ({
  syntaxHighlighting: vi.fn(() => "syntax-highlight"),
}));

vi.mock("@codemirror/autocomplete", () => ({
  closeBrackets: vi.fn(() => "closeBrackets"),
  closeBracketsKeymap: [],
}));

vi.mock("@codemirror/search", () => ({
  search: vi.fn(() => "search"),
}));

const { selectNextOccurrenceSource, selectAllOccurrencesSource } = vi.hoisted(() => ({
  selectNextOccurrenceSource: vi.fn(),
  selectAllOccurrencesSource: vi.fn(),
}));
vi.mock("@/plugins/codemirror/sourceSelectOccurrence", () => ({
  selectNextOccurrenceSource,
  selectAllOccurrencesSource,
}));

const { editorStoreState } = vi.hoisted(() => ({
  editorStoreState: { toggleWordWrap: vi.fn() },
}));
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: { getState: vi.fn(() => editorStoreState) },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("@/hooks/useUnifiedHistory", () => ({
  performUnifiedUndo: vi.fn(),
  performUnifiedRedo: vi.fn(),
}));

vi.mock("@/plugins/codemirror", () => ({
  sourceEditorTheme: "sourceEditorTheme",
  codeHighlightStyle: "codeHighlightStyle",
  createBrHidingPlugin: vi.fn((hide: boolean) => `brHiding:${hide}`),
  createListBlankLinePlugin: vi.fn(() => "listBlankLine"),
  createMarkdownAutoPairPlugin: vi.fn(() => "mdAutoPair"),
  markdownPairBackspace: { key: "Backspace", run: vi.fn() },
  tabEscapeKeymap: { key: "Tab", run: vi.fn() },
  tabIndentFallbackKeymap: { key: "Tab-fallback", run: vi.fn() },
  shiftTabIndentFallbackKeymap: { key: "Shift-Tab-fallback", run: vi.fn() },
  listContinuationKeymap: { key: "Enter", run: vi.fn() },
  tableTabKeymap: { key: "Tab-table", run: vi.fn() },
  tableShiftTabKeymap: { key: "Shift-Tab-table", run: vi.fn() },
  tableModEnterKeymap: { key: "Mod-Enter", run: vi.fn() },
  tableModShiftEnterKeymap: { key: "Mod-Shift-Enter", run: vi.fn() },
  tableArrowUpKeymap: { key: "ArrowUp", run: vi.fn() },
  tableArrowDownKeymap: { key: "ArrowDown", run: vi.fn() },
  createSmartPastePlugin: vi.fn(() => "smartPaste"),
  createSourceCopyOnSelectPlugin: vi.fn(() => "copyOnSelect"),
  createSourceFocusModePlugin: vi.fn(() => "focusMode"),
  createSourceTypewriterPlugin: vi.fn(() => "typewriter"),
  createImeGuardPlugin: vi.fn(() => "imeGuard"),
  imeScrollGuard: "imeScrollGuard",
  createSourceCursorContextPlugin: vi.fn(() => "cursorContext"),
  createSourceMathPreviewPlugin: vi.fn(() => "mathPreview"),
  createSourceImagePreviewPlugin: vi.fn(() => "imagePreview"),
  sourceMultiCursorExtensions: ["multiCursor"],
  sourceInactiveSelectionExtensions: ["inactiveSelection"],
  sourceTableContextMenuExtensions: ["tableContextMenu"],
  sourceTableCellHighlightExtensions: ["tableCellHighlight"],
  sourceDiagramPreviewExtensions: ["diagramPreview"],
  sourceAlertDecorationExtensions: ["alertDecoration"],
  sourceDetailsDecorationExtensions: ["detailsDecoration"],
  sourceMediaDecorationExtensions: ["mediaDecoration"],
  visualLineUpKeymap: { key: "ArrowUp-visual", run: vi.fn() },
  visualLineDownKeymap: { key: "ArrowDown-visual", run: vi.fn() },
  visualLineUpSelectKeymap: { key: "Shift-ArrowUp-visual", run: vi.fn() },
  visualLineDownSelectKeymap: { key: "Shift-ArrowDown-visual", run: vi.fn() },
  smartHomeKeymap: { key: "Home", run: vi.fn() },
  smartHomeSelectKeymap: { key: "Shift-Home", run: vi.fn() },
  structuralBackspaceKeymap: { key: "Backspace-structural", run: vi.fn() },
  structuralDeleteKeymap: { key: "Delete-structural", run: vi.fn() },
  listSmartIndentKeymap: { key: "Tab-list", run: vi.fn() },
  listSmartOutdentKeymap: { key: "Shift-Tab-list", run: vi.fn() },
}));

vi.mock("@/plugins/codemirror/sourceShortcuts", () => ({
  buildSourceShortcutKeymap: vi.fn(() => []),
}));

vi.mock("@/plugins/sourceContextDetection/taskListActions", () => ({
  toggleTaskList: vi.fn(),
}));

vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: vi.fn((binding: unknown) => binding),
}));

vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: vi.fn(() => true),
}));

vi.mock("@/plugins/sourceImagePopup", () => ({
  createSourceImagePopupPlugin: vi.fn(() => "imagePopup"),
}));

vi.mock("@/plugins/sourceLinkPopup", () => ({
  createSourceLinkPopupPlugin: vi.fn(() => "linkPopup"),
}));

vi.mock("@/plugins/sourceLinkCreatePopup", () => ({
  createSourceLinkCreatePopupPlugin: vi.fn(() => "linkCreatePopup"),
}));

vi.mock("@/plugins/sourceWikiLinkPopup", () => ({
  createSourceWikiLinkPopupPlugin: vi.fn(() => "wikiLinkPopup"),
}));

vi.mock("@/plugins/sourceFootnotePopup", () => ({
  createSourceFootnotePopupPlugin: vi.fn(() => "footnotePopup"),
}));

import {
  createSourceEditorExtensions,
  lineWrapCompartment,
  brVisibilityCompartment,
  autoPairCompartment,
  lineNumbersCompartment,
  shortcutKeymapCompartment,
  readOnlyCompartment,
} from "./sourceEditorExtensions";
import { keymap } from "@codemirror/view";
// selectNextOccurrenceSource and selectAllOccurrencesSource are hoisted mocks above

import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { toggleTaskList } from "@/plugins/sourceContextDetection/taskListActions";
import { isMacPlatform } from "@/utils/shortcutMatch";

describe("createSourceEditorExtensions", () => {
  it("returns a non-empty array of extensions", () => {
    const exts = createSourceEditorExtensions({
      initialWordWrap: true,
      initialShowBrTags: false,
      initialAutoPair: true,
      initialShowLineNumbers: true,
      updateListener: "listener" as any,
    });
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);
  });

  it("includes the update listener in the output", () => {
    const listener = "my-update-listener";
    const exts = createSourceEditorExtensions({
      initialWordWrap: false,
      initialShowBrTags: true,
      initialAutoPair: false,
      initialShowLineNumbers: false,
      updateListener: listener as any,
    });
    expect(exts).toContain(listener);
  });

  it("wires imeScrollGuard into the extension stack (issue #814 regression guard)", () => {
    const exts = createSourceEditorExtensions({
      initialWordWrap: false,
      initialShowBrTags: false,
      initialAutoPair: false,
      initialShowLineNumbers: false,
      updateListener: "listener" as any,
    });
    expect(exts).toContain("imeScrollGuard");
  });

  it("includes spread plugin arrays (multi-cursor, table, etc.)", () => {
    const exts = createSourceEditorExtensions({
      initialWordWrap: false,
      initialShowBrTags: false,
      initialAutoPair: false,
      initialShowLineNumbers: false,
      updateListener: "listener" as any,
    });
    expect(exts).toContain("multiCursor");
    expect(exts).toContain("inactiveSelection");
    expect(exts).toContain("tableContextMenu");
    expect(exts).toContain("tableCellHighlight");
    expect(exts).toContain("diagramPreview");
    expect(exts).toContain("alertDecoration");
    expect(exts).toContain("detailsDecoration");
    expect(exts).toContain("mediaDecoration");
  });
});

describe("exported compartments", () => {
  it("exports all six compartments", () => {
    expect(lineWrapCompartment).toBeDefined();
    expect(brVisibilityCompartment).toBeDefined();
    expect(autoPairCompartment).toBeDefined();
    expect(lineNumbersCompartment).toBeDefined();
    expect(shortcutKeymapCompartment).toBeDefined();
    expect(readOnlyCompartment).toBeDefined();
  });

  it("compartments have an 'of' method", () => {
    expect(typeof lineWrapCompartment.of).toBe("function");
    expect(typeof brVisibilityCompartment.of).toBe("function");
    expect(typeof autoPairCompartment.of).toBe("function");
    expect(typeof lineNumbersCompartment.of).toBe("function");
    expect(typeof shortcutKeymapCompartment.of).toBe("function");
    expect(typeof readOnlyCompartment.of).toBe("function");
  });
});

describe("createSourceEditorExtensions — keymap run() callbacks", () => {
  // The keymap array is embedded inside a keymap.of() call.
  // Since keymap.of is mocked as identity (returns its arg), we can intercept
  // the call to extract the keybinding objects and invoke their run() directly.

  type KeyBinding = { key: string; run: (view: unknown) => boolean };

  function getKeyBindings(): KeyBinding[] {
    const allBindings: KeyBinding[] = [];
    const origOf = vi.mocked(keymap.of);
    origOf.mockImplementation((bindings: unknown) => {
      if (Array.isArray(bindings)) {
        for (const b of bindings) {
          if (b && typeof b === "object" && "key" in b && "run" in b) {
            allBindings.push(b as KeyBinding);
          }
        }
      }
      return bindings as any;
    });

    createSourceEditorExtensions({
      initialWordWrap: false,
      initialShowBrTags: false,
      initialAutoPair: false,
      initialShowLineNumbers: false,
      updateListener: "listener" as any,
    });

    // Restore default mock
    origOf.mockImplementation((keys: unknown) => keys as any);
    return allBindings;
  }

  it("Mod-Shift-Enter run: calls toggleTaskList", () => {
    const mockView = {};
    const bindings = getKeyBindings();
    // Multiple bindings may share "Mod-Shift-Enter" (e.g. tableModShiftEnterKeymap).
    // The toggleTaskList binding is added later, so use findLast to get it.
    const binding = bindings.findLast((b) => b.key === "Mod-Shift-Enter");
    expect(binding).toBeDefined();
    vi.mocked(toggleTaskList).mockClear();
    binding!.run(mockView);
    // toggleTaskList is the vi.fn() from vi.mock
    expect(toggleTaskList).toHaveBeenCalledWith(mockView);
  });

  it("Mod-d run: calls selectNextOccurrenceSource and dispatches result", () => {
    const mockSpec = { selection: "mockSelection" };
    selectNextOccurrenceSource.mockReturnValue(mockSpec);
    const mockDispatch = vi.fn();
    const mockView = { state: "mockState", dispatch: mockDispatch };
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-d");
    expect(binding).toBeDefined();
    const result = binding!.run(mockView);
    expect(selectNextOccurrenceSource).toHaveBeenCalledWith("mockState");
    expect(mockDispatch).toHaveBeenCalledWith(mockSpec);
    expect(result).toBe(true);
  });

  it("Mod-d run: returns false when no occurrence found", () => {
    selectNextOccurrenceSource.mockReturnValue(null);
    const mockView = { state: "mockState", dispatch: vi.fn() };
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-d");
    expect(binding).toBeDefined();
    const result = binding!.run(mockView);
    expect(result).toBe(false);
    expect(mockView.dispatch).not.toHaveBeenCalled();
  });

  it("Mod-Shift-l run: calls selectAllOccurrencesSource and dispatches result", () => {
    const mockSpec = { selection: "mockSelection" };
    selectAllOccurrencesSource.mockReturnValue(mockSpec);
    const mockDispatch = vi.fn();
    const mockView = { state: "mockState", dispatch: mockDispatch };
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-Shift-l");
    expect(binding).toBeDefined();
    const result = binding!.run(mockView);
    expect(selectAllOccurrencesSource).toHaveBeenCalledWith("mockState");
    expect(mockDispatch).toHaveBeenCalledWith(mockSpec);
    expect(result).toBe(true);
  });

  it("Mod-Alt-w run: calls toggleWordWrap and returns true", () => {
    editorStoreState.toggleWordWrap.mockClear();
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-Alt-w");
    expect(binding).toBeDefined();
    const result = binding!.run({});
    expect(editorStoreState.toggleWordWrap).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("Mod-z run: calls performUnifiedUndo", () => {
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-z");
    expect(binding).toBeDefined();
    binding!.run({});
    expect(vi.mocked(performUnifiedUndo)).toHaveBeenCalledWith("main");
  });

  it("Mod-Shift-z run: calls performUnifiedRedo", () => {
    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-Shift-z");
    expect(binding).toBeDefined();
    binding!.run({});
    expect(vi.mocked(performUnifiedRedo)).toHaveBeenCalledWith("main");
  });

  it("Mod-y run: calls performUnifiedRedo on non-mac", () => {
    // Override isMacPlatform to return false so the Mod-y binding is included
    vi.mocked(isMacPlatform).mockReturnValueOnce(false);

    const bindings = getKeyBindings();
    const binding = bindings.find((b) => b.key === "Mod-y");
    expect(binding).toBeDefined();
    binding!.run({});
    expect(vi.mocked(performUnifiedRedo)).toHaveBeenCalledWith("main");
  });
});
