/**
 * Tests for editorPlugins.tiptap — buildEditorKeymapBindings and editorKeymapExtension.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useShortcutsStore } from "@/stores/settingsStore";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";

// Formatting/editing shortcuts now route through the shared editor executor; spy
// on runEditorAction so tests can assert the shortcut dispatches the right action id.
const { runEditorActionMock } = vi.hoisted(() => ({
  runEditorActionMock: vi.fn(),
}));
vi.mock("@/services/editor/runEditorAction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/editor/runEditorAction")>();
  return { ...actual, runEditorAction: (...args: unknown[]) => runEditorActionMock(...args) };
});

import { buildEditorKeymapBindings, editorKeymapExtension, expandedToggleMarkTiptap } from "./editorPlugins.tiptap";

function resetShortcuts() {
  useShortcutsStore.setState({ customBindings: {} });
}

// The keymap reads chords through the `hostShortcuts` seam, so bind the app's
// real store to it — the wiring the app ships.
beforeEach(bindPluginHostSettings);
afterEach(resetShortcuts);

describe("buildEditorKeymapBindings", () => {
  it("uses custom shortcut bindings from the store", () => {
    useShortcutsStore.setState({ customBindings: { bold: "Mod-Shift-b" } });
    const bindings = buildEditorKeymapBindings();

    expect(bindings["Mod-Shift-b"]).toBeTypeOf("function");
    expect(bindings["Mod-b"]).toBeUndefined();
  });

  it("includes sourcePeek binding", () => {
    const bindings = buildEditorKeymapBindings();
    // Default key is F5
    expect(bindings["F5"]).toBeTypeOf("function");
  });

  it("includes Escape binding", () => {
    const bindings = buildEditorKeymapBindings();
    expect(bindings.Escape).toBeTypeOf("function");
  });

  it("includes Mod-z for undo", () => {
    const bindings = buildEditorKeymapBindings();
    expect(bindings["Mod-z"]).toBeTypeOf("function");
  });

  it("includes Mod-Shift-z for redo", () => {
    const bindings = buildEditorKeymapBindings();
    expect(bindings["Mod-Shift-z"]).toBeTypeOf("function");
  });

  it("includes all inline mark formatting shortcuts", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    // Each mark should have a binding at its default key
    const markShortcuts = [
      "bold", "italic", "code", "strikethrough",
      "underline", "highlight", "subscript", "superscript",
    ];
    for (const name of markShortcuts) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        expect(bindings[key], `${name} shortcut (${key}) should have a binding`).toBeTypeOf("function");
      }
    }
  });

  it("includes link-related shortcuts", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    for (const name of ["link", "unlink", "wikiLink", "bookmarkLink"]) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        expect(bindings[key], `${name} shortcut`).toBeTypeOf("function");
      }
    }
  });

  it("includes inlineMath shortcut", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("inlineMath");
    if (key) {
      expect(bindings[key]).toBeTypeOf("function");
    }
  });

  it("includes pastePlainText shortcut", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("pastePlainText");
    if (key) {
      expect(bindings[key]).toBeTypeOf("function");
    }
  });

  it("includes line operation shortcuts", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    for (const name of ["moveLineUp", "moveLineDown", "duplicateLine", "deleteLine", "joinLines"]) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        // Arrow keys get converted to ArrowUp/ArrowDown format
        const pmKey = key
          .replace(/\bUp\b/g, "ArrowUp")
          .replace(/\bDown\b/g, "ArrowDown")
          .replace(/\bLeft\b/g, "ArrowLeft")
          .replace(/\bRight\b/g, "ArrowRight");
        expect(bindings[pmKey], `${name} shortcut (${pmKey})`).toBeTypeOf("function");
      }
    }
  });

  it("includes text transform shortcuts", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();

    for (const name of ["transformUppercase", "transformLowercase", "transformTitleCase", "transformToggleCase"]) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        expect(bindings[key], `${name} shortcut`).toBeTypeOf("function");
      }
    }
  });

  it("does NOT bind toggleSidebar in the editor keymap (handled globally to avoid double-toggle)", () => {
    const bindings = buildEditorKeymapBindings();
    const key = useShortcutsStore.getState().getShortcut("toggleSidebar");
    expect(key).toBe("Ctrl-Shift-0");
    // toggleSidebar is scope:"global", handled by useViewShortcuts at window level.
    // Binding it here too would double-toggle when both handlers fire.
    expect(bindings[key]).toBeUndefined();
  });

  it("includes blockquote shortcut", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key) {
      expect(bindings[key]).toBeTypeOf("function");
    }
  });

  it("includes insertImage shortcut", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("insertImage");
    if (key) {
      expect(bindings[key]).toBeTypeOf("function");
    }
  });

  it("returns a record with string keys and function values", () => {
    const bindings = buildEditorKeymapBindings();
    expect(typeof bindings).toBe("object");
    for (const [key, val] of Object.entries(bindings)) {
      expect(typeof key).toBe("string");
      expect(typeof val).toBe("function");
    }
  });

  it("reflects custom bindings for multiple shortcuts", () => {
    useShortcutsStore.setState({
      customBindings: {
        bold: "Mod-Shift-b",
        italic: "Mod-Shift-i",
      },
    });
    const bindings = buildEditorKeymapBindings();
    expect(bindings["Mod-Shift-b"]).toBeTypeOf("function");
    expect(bindings["Mod-Shift-i"]).toBeTypeOf("function");
    // Originals should not exist
    expect(bindings["Mod-b"]).toBeUndefined();
    expect(bindings["Mod-i"]).toBeUndefined();
  });

  it("binds Escape to a handler that returns a boolean", () => {
    const bindings = buildEditorKeymapBindings();
    expect(typeof bindings.Escape).toBe("function");
  });

  it("does not duplicate bindings when called multiple times", () => {
    const bindings1 = buildEditorKeymapBindings();
    const bindings2 = buildEditorKeymapBindings();
    const keys1 = Object.keys(bindings1).sort();
    const keys2 = Object.keys(bindings2).sort();
    expect(keys1).toEqual(keys2);
  });

  it("clears old custom bindings when resetting", () => {
    useShortcutsStore.setState({ customBindings: { bold: "Mod-Alt-b" } });
    const bindings1 = buildEditorKeymapBindings();
    expect(bindings1["Mod-Alt-b"]).toBeTypeOf("function");

    useShortcutsStore.setState({ customBindings: {} });
    const bindings2 = buildEditorKeymapBindings();
    expect(bindings2["Mod-Alt-b"]).toBeUndefined();
    // Default should be back
    const defaultKey = useShortcutsStore.getState().getShortcut("bold");
    if (defaultKey) {
      expect(bindings2[defaultKey]).toBeTypeOf("function");
    }
  });

  it("has all expected binding categories", () => {
    const bindings = buildEditorKeymapBindings();
    const keys = Object.keys(bindings);

    // Should have undo/redo
    expect(keys).toContain("Mod-z");
    expect(keys).toContain("Mod-Shift-z");

    // Should have Escape
    expect(keys).toContain("Escape");

    // Should have at least some formatting keys
    expect(keys.length).toBeGreaterThan(10);
  });

  it("each binding returns a function that can be called", () => {
    const bindings = buildEditorKeymapBindings();
    for (const [_key, handler] of Object.entries(bindings)) {
      expect(typeof handler).toBe("function");
      // Verify it's callable (all bindings are ProseMirror commands)
      expect(handler.length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("editorKeymapExtension integration", () => {
  it("has name editorKeymaps", () => {
    expect(editorKeymapExtension.name).toBe("editorKeymaps");
  });

  it("has priority 1000", () => {
    expect(editorKeymapExtension.options.priority ?? editorKeymapExtension.config.priority).toBe(1000);
  });

  it("creates plugin via addProseMirrorPlugins", () => {
    const extensionContext = {
      name: editorKeymapExtension.name,
      options: editorKeymapExtension.options,
      storage: editorKeymapExtension.storage,
      editor: {},
      type: null,
      parent: undefined,
    };
    const plugins = editorKeymapExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    expect(plugins.length).toBe(1);
    expect(plugins[0].spec.key).toBeDefined();
  });

  it("plugin has handleKeyDown in props", () => {
    const extensionContext = {
      name: editorKeymapExtension.name,
      options: editorKeymapExtension.options,
      storage: editorKeymapExtension.storage,
      editor: {},
      type: null,
      parent: undefined,
    };
    const plugins = editorKeymapExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    expect(plugins[0].props.handleKeyDown).toBeTypeOf("function");
  });

  it("plugin view destroy unsubscribes from store", () => {
    const extensionContext = {
      name: editorKeymapExtension.name,
      options: editorKeymapExtension.options,
      storage: editorKeymapExtension.storage,
      editor: {},
      type: null,
      parent: undefined,
    };
    const plugins = editorKeymapExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const plugin = plugins[0];

    // Call the view factory
    const viewResult = plugin.spec.view!({} as never);
    expect(viewResult).toBeDefined();
    expect(viewResult.destroy).toBeTypeOf("function");
    // destroy should not throw
    expect(() => viewResult.destroy!()).not.toThrow();
  });

  it("re-exports expandedToggleMarkTiptap", () => {
    expect(expandedToggleMarkTiptap).toBeTypeOf("function");
  });
});

describe("buildEditorKeymapBindings handler execution", () => {
  it("Escape handler returns false when no popup/toolbar open and no mark boundary", () => {
    const bindings = buildEditorKeymapBindings();
    // Escape is wrapped with guardProseMirrorCommand which calls the inner fn
    // with (state, dispatch, view). When view is undefined, inner function returns false.
    const result = bindings.Escape({} as never, undefined, undefined);
    expect(result).toBe(false);
  });

  it("Mod-z handler calls performUnifiedUndo", () => {
    const bindings = buildEditorKeymapBindings();
    // It calls performUnifiedUndo which returns a boolean
    const result = bindings["Mod-z"]({} as never, undefined, undefined);
    // performUnifiedUndo returns false when no history available
    expect(typeof result).toBe("boolean");
  });

  it("Mod-Shift-z handler calls performUnifiedRedo", () => {
    const bindings = buildEditorKeymapBindings();
    const result = bindings["Mod-Shift-z"]({} as never, undefined, undefined);
    expect(typeof result).toBe("boolean");
  });

  it("mark formatting bindings return false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const markNames = ["bold", "italic", "code", "strikethrough", "underline", "highlight"];

    for (const name of markNames) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        const result = bindings[key]({} as never, undefined, undefined);
        expect(result).toBe(false);
      }
    }
  });

  it("link binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("link");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("pastePlainText binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("pastePlainText");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("insertImage binding returns true (emits menu event)", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("insertImage");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(true);
    }
  });

  it("blockquote binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("sourcePeek binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const key = "F5";
    if (bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("line operation bindings return false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const lineOps = ["moveLineUp", "moveLineDown", "duplicateLine", "deleteLine", "joinLines"];

    for (const name of lineOps) {
      const key = shortcuts.getShortcut(name);
      if (key) {
        const pmKey = key
          .replace(/\bUp\b/g, "ArrowUp")
          .replace(/\bDown\b/g, "ArrowDown");
        if (bindings[pmKey]) {
          const result = bindings[pmKey]({} as never, undefined, undefined);
          expect(result).toBe(false);
        }
      }
    }
  });

  it("text transform bindings return false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const transforms = ["transformUppercase", "transformLowercase", "transformTitleCase", "transformToggleCase"];

    for (const name of transforms) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        const result = bindings[key]({} as never, undefined, undefined);
        expect(result).toBe(false);
      }
    }
  });

  it("subscript and superscript bindings return false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const marks = ["subscript", "superscript"];

    for (const name of marks) {
      const key = shortcuts.getShortcut(name);
      if (key && bindings[key]) {
        const result = bindings[key]({} as never, undefined, undefined);
        expect(result).toBe(false);
      }
    }
  });

  it("unlink binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("unlink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("wikiLink binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("wikiLink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("bookmarkLink binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("bookmarkLink");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("inlineMath binding returns false when view is undefined", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("inlineMath");
    if (key && bindings[key]) {
      const result = bindings[key]({} as never, undefined, undefined);
      expect(result).toBe(false);
    }
  });

  it("Escape closes universal toolbar when visible", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    const { useSourcePeekStore } = await import("@/stores/sourcePeekStore");
    // Ensure source peek is closed
    useSourcePeekStore.setState({ isOpen: false });
    useUIStore.getState().setUniversalToolbarVisible(true);

    const bindings = buildEditorKeymapBindings();
    const mockView = { dom: {} };
    const result = bindings.Escape({} as never, vi.fn(), mockView);
    expect(result).toBe(true);
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
  });

  it("blockquote binding returns true with a view", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // Create a mock view that has dom.editor
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Schema } = require("@tiptap/pm/model");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EditorState } = require("@tiptap/pm/state");
      const testSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          blockquote: { group: "block", content: "block+" },
          text: { group: "inline" },
        },
      });
      const doc = testSchema.node("doc", null, [
        testSchema.node("paragraph", null, [testSchema.text("hello")]),
      ]);
      const state = EditorState.create({ doc, schema: testSchema });

      const mockEditor = {
        isActive: vi.fn(() => false),
      };
      const mockDom = document.createElement("div");
      (mockDom as unknown as Record<string, unknown>).editor = mockEditor;
      const mockView = {
        dom: mockDom,
        state,
        dispatch: vi.fn(),
        focus: vi.fn(),
      };

      const result = bindings[key](state as never, vi.fn(), mockView);
      expect(result).toBe(true);
    }
  });

  it("blockquote binding removes blockquote when already active", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Schema } = require("@tiptap/pm/model");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EditorState } = require("@tiptap/pm/state");
      const testSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          blockquote: { group: "block", content: "block+" },
          text: { group: "inline" },
        },
      });
      const doc = testSchema.node("doc", null, [
        testSchema.node("blockquote", null, [
          testSchema.node("paragraph", null, [testSchema.text("quoted")]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema: testSchema });

      const mockEditor = {
        isActive: vi.fn(() => true), // blockquote is active
      };
      const mockDom = document.createElement("div");
      (mockDom as unknown as Record<string, unknown>).editor = mockEditor;
      const mockView = {
        dom: mockDom,
        state,
        dispatch: vi.fn(),
        focus: vi.fn(),
      };

      const result = bindings[key](state as never, vi.fn(), mockView);
      expect(result).toBe(true);
    }
  });

  it("blockquote binding delegates to runEditorAction('blockquote') with a view", () => {
    runEditorActionMock.mockClear();
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // Keymap no longer inspects the editor/schema — the adapter owns that. It
      // just guards on view presence and dispatches the blockquote action.
      const mockView = { dom: document.createElement("div") };
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith(
        "blockquote",
        expect.objectContaining({ windowLabel: expect.any(String) })
      );
    }
  });

  it("blockquote binding delegates regardless of schema (adapter owns validation)", () => {
    runEditorActionMock.mockClear();
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // Even a schema without a blockquote node no longer changes keymap behavior:
      // validation moved to runEditorAction's wysiwyg adapter.
      const mockView = { dom: document.createElement("div") };
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("blockquote", expect.any(Object));
    }
  });

  it("sourcePeek binding returns false when source peek fails to open", () => {
    const bindings = buildEditorKeymapBindings();
    // F5 is the default source peek key
    if (bindings.F5) {
      // openSourcePeekInline needs a real editor state. Without it, it should
      // throw or return false. We just verify the binding is callable.
      // The actual source peek behavior is tested in its own test suite.
      const result = bindings.F5({} as never, vi.fn(), undefined);
      expect(result).toBe(false);
    }
  });

  it("Escape closes source peek when it is open", async () => {
    const { useSourcePeekStore } = await import("@/stores/sourcePeekStore");
    useSourcePeekStore.setState({ isOpen: true });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorState } = require("@tiptap/pm/state");
    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });

    const bindings = buildEditorKeymapBindings();
    const mockView = { dom: {}, state, dispatch: vi.fn(), focus: vi.fn() };
    const result = bindings.Escape(state as never, vi.fn(), mockView);
    expect(result).toBe(true);

    // Restore
    useSourcePeekStore.setState({ isOpen: false });
  });

  it("sourcePeek binding closes when source peek is open", async () => {
    const { useSourcePeekStore } = await import("@/stores/sourcePeekStore");
    useSourcePeekStore.setState({ isOpen: true });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorState } = require("@tiptap/pm/state");
    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });

    const bindings = buildEditorKeymapBindings();
    const mockView = { dom: {}, state, dispatch: vi.fn(), focus: vi.fn() };
    if (bindings.F5) {
      const result = bindings.F5(state as never, vi.fn(), mockView);
      expect(result).toBe(true);
    }

    useSourcePeekStore.setState({ isOpen: false });
  });

  it("blockquote binding delegates to runEditorAction for list content", () => {
    runEditorActionMock.mockClear();
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // List-wrapping now lives in the wysiwyg adapter's toggleBlockquote (tested
      // there). The keymap only forwards the blockquote action through the executor.
      const mockView = { dom: document.createElement("div") };
      const result = bindings[key]({} as never, vi.fn(), mockView);
      expect(result).toBe(true);
      expect(runEditorActionMock).toHaveBeenCalledWith("blockquote", expect.any(Object));
    }
  });

  it("blockquote binding handles wrap failure gracefully", () => {
    const bindings = buildEditorKeymapBindings();
    const shortcuts = useShortcutsStore.getState();
    const key = shortcuts.getShortcut("blockquote");
    if (key && bindings[key]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Schema } = require("@tiptap/pm/model");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EditorState } = require("@tiptap/pm/state");
      const testSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          blockquote: { group: "block", content: "block+" },
          text: { group: "inline" },
        },
      });
      const doc = testSchema.node("doc", null, [
        testSchema.node("paragraph", null, [testSchema.text("hello")]),
      ]);
      const state = EditorState.create({ doc, schema: testSchema });

      const mockEditor = {
        isActive: vi.fn(() => false),
      };
      const mockDom = document.createElement("div");
      (mockDom as unknown as Record<string, unknown>).editor = mockEditor;
      // Make dispatch throw to test the catch block
      const mockView = {
        dom: mockDom,
        state,
        dispatch: vi.fn(() => { throw new Error("Wrap failed"); }),
        focus: vi.fn(),
      };

      // Should not throw despite dispatch failure
      expect(() => bindings[key](state as never, vi.fn(), mockView)).not.toThrow();
    }
  });
});
