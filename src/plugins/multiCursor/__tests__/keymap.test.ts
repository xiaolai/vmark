/**
 * Tests for multi-cursor keymap plugin
 *
 * Tests:
 * 1. wrapCommand: converts (state => Transaction|null) to ProseMirror Command
 * 2. wrapViewCommand: converts (state, view => Transaction|null) to ProseMirror Command
 * 3. multiCursorKeymap plugin creation and Escape binding
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, SelectionRange } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  multiCursorKeymap,
  buildMultiCursorKeymapBindings,
  wrapCommand,
  wrapViewCommand,
} from "../keymap";
import { MultiSelection } from "../MultiSelection";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { collapseMultiSelection } from "../commands";
import { useShortcutsStore } from "@/stores/settingsStore";

afterEach(() => {
  useShortcutsStore.setState({ customBindings: {} });
  vi.restoreAllMocks();
});

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createState(text: string) {
  const doc = createDoc(text);
  return EditorState.create({
    doc,
    schema,
    plugins: [multiCursorPlugin(), multiCursorKeymap()],
  });
}

function createMultiCursorState(
  text: string,
  positions: Array<{ from: number; to: number }>
) {
  const state = createState(text);
  const doc = state.doc;
  const ranges = positions.map((p) => {
    const $from = doc.resolve(p.from);
    const $to = doc.resolve(p.to);
    return new SelectionRange($from, $to);
  });
  const multiSel = new MultiSelection(ranges, 0);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("multiCursorKeymap", () => {
  describe("plugin creation", () => {
    it("creates a valid ProseMirror plugin", () => {
      const plugin = multiCursorKeymap();
      expect(plugin).toBeDefined();
      expect(plugin.spec).toBeDefined();
    });

    it("integrates with EditorState alongside multiCursorPlugin", () => {
      const state = createState("hello world");
      expect(state.plugins).toHaveLength(2);
    });

    it("has handleKeyDown prop", () => {
      const plugin = multiCursorKeymap();
      expect(plugin.props.handleKeyDown).toBeDefined();
    });
  });

  describe("wrapCommand", () => {
    it("returns true and dispatches when inner fn returns a transaction", () => {
      const state = createState("hello world");
      const mockTr = state.tr;
      const innerFn = vi.fn(() => mockTr);
      const command = wrapCommand(innerFn);

      const dispatch = vi.fn();
      const result = command(state, dispatch);

      expect(result).toBe(true);
      expect(innerFn).toHaveBeenCalledWith(state);
      expect(dispatch).toHaveBeenCalledWith(mockTr);
    });

    it("returns false when inner fn returns null", () => {
      const state = createState("hello world");
      const innerFn = vi.fn(() => null);
      const command = wrapCommand(innerFn);

      const dispatch = vi.fn();
      const result = command(state, dispatch);

      expect(result).toBe(false);
      expect(innerFn).toHaveBeenCalledWith(state);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("returns true but does not dispatch in dry-run mode (dispatch undefined)", () => {
      const state = createState("hello world");
      const mockTr = state.tr;
      const innerFn = vi.fn(() => mockTr);
      const command = wrapCommand(innerFn);

      // ProseMirror calls commands with undefined dispatch to probe
      const result = command(state, undefined);

      expect(result).toBe(true);
      expect(innerFn).toHaveBeenCalledWith(state);
    });
  });

  describe("wrapViewCommand", () => {
    it("returns false when view is undefined", () => {
      const state = createState("hello world");
      const innerFn = vi.fn(() => state.tr);
      const command = wrapViewCommand(innerFn);

      const dispatch = vi.fn();
      const result = command(state, dispatch, undefined);

      expect(result).toBe(false);
      expect(innerFn).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("returns true and dispatches when view is provided and fn returns transaction", () => {
      const state = createState("hello world");
      const mockTr = state.tr;
      const mockView = { state } as EditorView;
      const innerFn = vi.fn(() => mockTr);
      const command = wrapViewCommand(innerFn);

      const dispatch = vi.fn();
      const result = command(state, dispatch, mockView);

      expect(result).toBe(true);
      expect(innerFn).toHaveBeenCalledWith(state, mockView);
      expect(dispatch).toHaveBeenCalledWith(mockTr);
    });

    it("returns false when view is provided but fn returns null", () => {
      const state = createState("hello world");
      const mockView = { state } as EditorView;
      const innerFn = vi.fn(() => null);
      const command = wrapViewCommand(innerFn);

      const dispatch = vi.fn();
      const result = command(state, dispatch, mockView);

      expect(result).toBe(false);
      expect(innerFn).toHaveBeenCalledWith(state, mockView);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("returns true but does not dispatch in dry-run mode (dispatch undefined)", () => {
      const state = createState("hello world");
      const mockTr = state.tr;
      const mockView = { state } as EditorView;
      const innerFn = vi.fn(() => mockTr);
      const command = wrapViewCommand(innerFn);

      const result = command(state, undefined, mockView);

      expect(result).toBe(true);
      expect(innerFn).toHaveBeenCalledWith(state, mockView);
    });
  });

  describe("Escape binding via handleKeyDown", () => {
    it("dispatches collapse on Escape with MultiSelection", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const keymapPlugin = state.plugins[1];
      const handleKeyDown = keymapPlugin.props.handleKeyDown;
      expect(handleKeyDown).toBeDefined();

      const dispatched: Transaction[] = [];
      const mockView = {
        state,
        dispatch: (tr: Transaction) => dispatched.push(tr),
      } as never;

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const result = handleKeyDown!(mockView, event);

      expect(result).toBe(true);
      expect(dispatched).toHaveLength(1);
    });

    it("returns false on Escape with single selection", () => {
      const state = createState("hello world");
      const keymapPlugin = state.plugins[1];
      const handleKeyDown = keymapPlugin.props.handleKeyDown;

      const mockView = {
        state,
        dispatch: vi.fn(),
      } as never;

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const result = handleKeyDown!(mockView, event);

      expect(result).toBe(false);
    });
  });

  describe("unbound keys", () => {
    it("returns false for unbound keys", () => {
      const state = createState("hello world");
      const keymapPlugin = state.plugins[1];
      const handleKeyDown = keymapPlugin.props.handleKeyDown;

      const mockView = { state, dispatch: vi.fn() } as never;
      const event = new KeyboardEvent("keydown", { key: "x" });
      const result = handleKeyDown!(mockView, event);
      expect(result).toBe(false);
    });

    it("returns false for modifier-only keys", () => {
      const state = createState("hello world");
      const keymapPlugin = state.plugins[1];
      const handleKeyDown = keymapPlugin.props.handleKeyDown;

      const mockView = { state, dispatch: vi.fn() } as never;
      const event = new KeyboardEvent("keydown", { key: "Shift" });
      const result = handleKeyDown!(mockView, event);
      expect(result).toBe(false);
    });
  });

  describe("buildMultiCursorKeymapBindings — store-driven chords", () => {
    it("binds the four rebindable chords at their default keys", () => {
      const b = buildMultiCursorKeymapBindings();
      // addCursorAbove default "Mod-Alt-Up" → "Mod-Alt-ArrowUp"
      expect(b["Mod-Alt-ArrowUp"]).toBeTypeOf("function");
      // addCursorBelow default "Mod-Alt-Down" → "Mod-Alt-ArrowDown"
      expect(b["Mod-Alt-ArrowDown"]).toBeTypeOf("function");
      expect(b["Mod-Shift-d"]).toBeTypeOf("function"); // skipOccurrence
      expect(b["Alt-Mod-z"]).toBeTypeOf("function"); // softUndoCursor
    });

    it("keeps the fixed (non-rebindable) chords bound", () => {
      const b = buildMultiCursorKeymapBindings();
      expect(b["Mod-d"]).toBeTypeOf("function"); // selectNextOccurrence
      expect(b["Mod-Shift-l"]).toBeTypeOf("function"); // selectAllOccurrences
      expect(b.Escape).toBeTypeOf("function");
    });

    it("resolves a rebound chord from the store and drops the old one", () => {
      useShortcutsStore.setState({ customBindings: { addCursorAbove: "Mod-Alt-k" } });
      const b = buildMultiCursorKeymapBindings();
      expect(b["Mod-Alt-k"]).toBeTypeOf("function");
      expect(b["Mod-Alt-ArrowUp"]).toBeUndefined();
    });

    it("a rebind colliding with a fixed chord does NOT clobber it (audit-fix #1)", () => {
      // Rebind skipOccurrence onto Mod-d, which the fixed selectNextOccurrence owns.
      useShortcutsStore.setState({ customBindings: { skipOccurrence: "Mod-d" } });
      const b = buildMultiCursorKeymapBindings();
      // Fixed Mod-d (selectNextOccurrence) is preserved — bound FIRST, guard skips
      // the colliding rebind rather than silently destroying the mechanic.
      expect(b["Mod-d"]).toBeTypeOf("function");
      // And skipOccurrence's default Mod-Shift-d is gone (it moved onto the guarded
      // Mod-d), so the rebind is inert on that chord — no double-binding.
      expect(b["Mod-Shift-d"]).toBeUndefined();
    });

    it("skips a rebindable chord when getShortcut resolves to empty (unbound)", () => {
      const orig = useShortcutsStore.getState().getShortcut;
      vi.spyOn(useShortcutsStore.getState(), "getShortcut").mockImplementation((id) =>
        id === "softUndoCursor" ? "" : orig(id)
      );
      const b = buildMultiCursorKeymapBindings();
      expect(b["Alt-Mod-z"]).toBeUndefined();
      // Fixed chords are unaffected by an unbound rebindable chord.
      expect(b["Mod-d"]).toBeTypeOf("function");
    });
  });

  describe("live rebuild on shortcuts-store change", () => {
    it("rebuilds handleKeyDown when a rebindable chord is rebound", () => {
      const plugin = multiCursorKeymap();
      const handleKeyDown = plugin.props.handleKeyDown;
      expect(handleKeyDown).toBeDefined();

      // MultiSelection where skipOccurrence deterministically returns a tr.
      const state = createMultiCursorState("hello world hello", [
        { from: 1, to: 6 },
        { from: 13, to: 18 },
      ]);
      const dispatched: Transaction[] = [];
      const mockView = {
        state,
        dispatch: (tr: Transaction) => dispatched.push(tr),
      } as never;

      // Start the per-view store subscription (it now lives in the plugin's
      // view() lifecycle, not at plugin creation — audit-fix #2).
      const pluginView = plugin.spec.view!(mockView);

      // F6 is not bound to skipOccurrence initially.
      expect(handleKeyDown!(mockView, new KeyboardEvent("keydown", { key: "F6" }))).toBe(false);
      expect(dispatched).toHaveLength(0);

      // Rebind skipOccurrence → F6. The store subscription must rebuild the keymap.
      useShortcutsStore.setState({ customBindings: { skipOccurrence: "F6" } });

      expect(handleKeyDown!(mockView, new KeyboardEvent("keydown", { key: "F6" }))).toBe(true);
      expect(dispatched).toHaveLength(1);

      // Destroying the view unsubscribes (no leak).
      pluginView.destroy?.();
    });
  });

  describe("collapseMultiSelection command (used by Escape binding)", () => {
    it("collapses to primary cursor position", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const tr = collapseMultiSelection(state);
      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        expect(newState.selection).toBeInstanceOf(TextSelection);
        expect(newState.selection.from).toBe(1);
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world");
      const tr = collapseMultiSelection(state);
      expect(tr).toBeNull();
    });

    it("preserves primary selection range", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const tr = collapseMultiSelection(state);
      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        expect(newState.selection.from).toBe(1);
        expect(newState.selection.to).toBe(6);
      }
    });
  });
});
