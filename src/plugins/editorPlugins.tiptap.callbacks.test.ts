/**
 * Tests for editorPlugins.tiptap — inner callback execution paths.
 * Formatting/link/line/transform shortcuts now delegate to the shared editor
 * executor, so these verify the terminal runEditorAction dispatch (<actionId>).
 * The bindings that stay direct (unlink, pastePlainText, sourcePeek — no editor
 * action) still assert their original handler.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Spy on runEditorAction — the terminal call for every routed shortcut.
const { runEditorActionMock } = vi.hoisted(() => ({
  runEditorActionMock: vi.fn(),
}));
vi.mock("@/services/editor/runEditorAction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/editor/runEditorAction")>();
  return { ...actual, runEditorAction: (...args: unknown[]) => runEditorActionMock(...args) };
});

// Handlers still invoked directly by the keymap (CommandBus gaps).
vi.mock("./editorPlugins/linkCommands", () => ({
  handleUnlinkShortcut: vi.fn(() => true),
}));
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  triggerPastePlainText: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/plugins/sourcePeekInline", () => ({
  openSourcePeekInline: vi.fn(() => true),
  revertAndCloseSourcePeek: vi.fn(),
}));
// These two moved to unifiedUndoRedo.ts when unifiedHistory.ts was split for
// the size gate; mocking the old path leaves the mock INERT and silently runs
// the real commands.
vi.mock("@/services/history/unifiedUndoRedo", () => ({
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
import { handleUnlinkShortcut } from "./editorPlugins/linkCommands";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";

function resetShortcuts() {
  useShortcutsStore.setState({ customBindings: {} });
}

afterEach(() => {
  resetShortcuts();
  vi.clearAllMocks();
});

const mockView = { dom: document.createElement("div"), state: {}, dispatch: vi.fn(), focus: vi.fn() };

describe("buildEditorKeymapBindings callback execution with view", () => {
  it("inline mark formatting bindings dispatch <mark> via the editor executor", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const markMap: Record<string, string> = {
      bold: "bold", italic: "italic", code: "code",
      strikethrough: "strikethrough", underline: "underline",
      highlight: "highlight", subscript: "subscript", superscript: "superscript",
    };

    for (const [name, actionId] of Object.entries(markMap)) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        runEditorActionMock.mockClear();
        const result = bindings[key]({} as never, vi.fn(), mockView);
        expect(result).toBe(true);
        expect(runEditorActionMock).toHaveBeenCalledWith(actionId, expect.any(Object));
      }
    }
  });

  it("link binding dispatches link", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("link");
    if (key && bindings[key]) {
      runEditorActionMock.mockClear();
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("link", expect.any(Object));
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

  it("wikiLink binding dispatches wikiLink", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("wikiLink");
    if (key && bindings[key]) {
      runEditorActionMock.mockClear();
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("wikiLink", expect.any(Object));
    }
  });

  it("bookmarkLink binding dispatches bookmark", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("bookmarkLink");
    if (key && bindings[key]) {
      runEditorActionMock.mockClear();
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("bookmark", expect.any(Object));
    }
  });

  it("inlineMath binding dispatches insertInlineMath", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("inlineMath");
    if (key && bindings[key]) {
      runEditorActionMock.mockClear();
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("insertInlineMath", expect.any(Object));
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

  it("line operation bindings dispatch their editor actions", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const ops: Record<string, string> = {
      moveLineUp: "moveLineUp",
      moveLineDown: "moveLineDown",
      duplicateLine: "duplicateLine",
      deleteLine: "deleteLine",
      joinLines: "joinLines",
    };

    for (const [name, actionId] of Object.entries(ops)) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        const pmKey = key.replace(/\bUp\b/g, "ArrowUp").replace(/\bDown\b/g, "ArrowDown");
        if (bindings[pmKey]) {
          runEditorActionMock.mockClear();
          const result = bindings[pmKey]({} as never, vi.fn(), mockView);
          expect(result).toBe(true);
          expect(runEditorActionMock).toHaveBeenCalledWith(actionId, expect.any(Object));
        }
      }
    }
  });

  it("text transform bindings dispatch their editor actions", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    const transforms: Record<string, string> = {
      transformUppercase: "transformUppercase",
      transformLowercase: "transformLowercase",
      transformTitleCase: "transformTitleCase",
      transformToggleCase: "transformToggleCase",
    };

    for (const [name, actionId] of Object.entries(transforms)) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        runEditorActionMock.mockClear();
        const result = bindings[key]({} as never, vi.fn(), mockView);
        expect(result).toBe(true);
        expect(runEditorActionMock).toHaveBeenCalledWith(actionId, expect.any(Object));
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
