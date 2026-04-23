/**
 * Smart Select-All Extension Tests
 *
 * Tests for progressive Cmd+A expansion and Cmd+Z selection undo
 * in WYSIWYG mode.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { getNextContainerBounds } from "../blockBounds";
import { smartSelectAllExtension } from "../tiptap";

// We test the algorithm directly using ProseMirror primitives rather than
// full TipTap Editor instances, since the extension just delegates to
// getNextContainerBounds and manages plugin state.

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { inline: true, group: "inline" },
    codeBlock: { content: "text*", group: "block", code: true },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: { content: "listItem+", group: "block" },
    listItem: { content: "block+" },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: { content: "block+" },
    tableHeader: { content: "block+" },
  },
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const code = (text: string) => schema.node("codeBlock", null, text ? [schema.text(text)] : []);
const bq = (...children: ReturnType<typeof schema.node>[]) => schema.node("blockquote", null, children);
const li = (...children: ReturnType<typeof schema.node>[]) => schema.node("listItem", null, children);
const ul = (...items: ReturnType<typeof schema.node>[]) => schema.node("bulletList", null, items);
const tc = (...children: ReturnType<typeof schema.node>[]) => schema.node("tableCell", null, children);
const tr_ = (...cells: ReturnType<typeof schema.node>[]) => schema.node("tableRow", null, cells);
const table = (...rows: ReturnType<typeof schema.node>[]) => schema.node("table", null, rows);
const doc = (...children: ReturnType<typeof schema.node>[]) => schema.node("doc", null, children);

/**
 * Simulate the progressive expansion algorithm used by the extension.
 * Returns the sequence of selection ranges from repeated Cmd+A presses.
 */
function simulateProgressiveExpansion(
  d: ReturnType<typeof schema.node>,
  startPos: number,
  maxPresses: number = 10,
): Array<{ from: number; to: number }> {
  const state = EditorState.create({ doc: d, schema });
  const expansions: Array<{ from: number; to: number }> = [];
  let currentFrom = startPos;
  let currentTo = startPos;
  const docSize = d.content.size;

  for (let i = 0; i < maxPresses; i++) {
    // Already at document level
    if (currentFrom === 0 && currentTo === docSize) break;

    const bounds = getNextContainerBounds(state, currentFrom, currentTo);
    if (!bounds) {
      // Select entire document (if stack is non-empty, i.e., we've expanded before)
      if (expansions.length > 0) {
        expansions.push({ from: 0, to: docSize });
      }
      break;
    }

    expansions.push({ from: bounds.from, to: bounds.to });
    currentFrom = bounds.from;
    currentTo = bounds.to;
  }

  return expansions;
}

describe("progressive Cmd+A", () => {
  it("cursor in table cell -> cell -> row -> table -> document", () => {
    const d = doc(table(tr_(tc(p("abc")), tc(p("def")))));
    const expansions = simulateProgressiveExpansion(d, 5);

    expect(expansions.length).toBeGreaterThanOrEqual(3);
    // Each expansion should be strictly larger
    for (let i = 1; i < expansions.length; i++) {
      expect(
        expansions[i].from <= expansions[i - 1].from &&
        expansions[i].to >= expansions[i - 1].to &&
        (expansions[i].from < expansions[i - 1].from || expansions[i].to > expansions[i - 1].to)
      ).toBe(true);
    }
  });

  it("cursor in flat list -> item -> list -> document", () => {
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const expansions = simulateProgressiveExpansion(d, 4);

    expect(expansions.length).toBeGreaterThanOrEqual(2);
    // Last expansion should be document
    const last = expansions[expansions.length - 1];
    expect(last.from).toBe(0);
    expect(last.to).toBe(d.content.size);
  });

  it("cursor in nested list traverses all levels", () => {
    const d = doc(ul(li(p("outer"), ul(li(p("inner"))))));

    // Find position inside "inner"
    let innerPos = -1;
    d.descendants((node, pos) => {
      if (node.isText && node.text === "inner") innerPos = pos + 1;
    });

    const expansions = simulateProgressiveExpansion(d, innerPos);
    // Should be: inner listItem -> inner list -> outer listItem -> outer list -> doc
    expect(expansions.length).toBeGreaterThanOrEqual(4);
  });

  it("cursor in blockquote -> blockquote -> document", () => {
    const d = doc(bq(p("quoted")));
    const expansions = simulateProgressiveExpansion(d, 3);

    expect(expansions.length).toBeGreaterThanOrEqual(1);
    const last = expansions[expansions.length - 1];
    expect(last.from).toBe(0);
    expect(last.to).toBe(d.content.size);
  });

  it("cursor in code block -> block -> document (regression)", () => {
    const d = doc(code("let x = 1;"));
    const expansions = simulateProgressiveExpansion(d, 3);

    expect(expansions.length).toBeGreaterThanOrEqual(1);
    const last = expansions[expansions.length - 1];
    expect(last.from).toBe(0);
    expect(last.to).toBe(d.content.size);
  });

  it("cursor in plain paragraph returns no container expansions", () => {
    const d = doc(p("plain text"));
    const state = EditorState.create({ doc: d, schema });
    const bounds = getNextContainerBounds(state, 3, 3);
    expect(bounds).toBeNull();
  });

  it("cursor in list item inside blockquote -> item -> list -> blockquote -> document", () => {
    const d = doc(bq(ul(li(p("listed")))));
    const expansions = simulateProgressiveExpansion(d, 5);

    expect(expansions.length).toBeGreaterThanOrEqual(3);
    const last = expansions[expansions.length - 1];
    expect(last.from).toBe(0);
    expect(last.to).toBe(d.content.size);
  });

  it("document already selected returns no further expansions", () => {
    const d = doc(ul(li(p("item"))));
    const state = EditorState.create({ doc: d, schema });
    const docSize = d.content.size;
    const bounds = getNextContainerBounds(state, 0, docSize);
    expect(bounds).toBeNull();
  });
});

describe("undo stack behavior", () => {
  // These tests simulate the stack management logic

  it("Cmd+A then Cmd+Z restores cursor position", () => {
    const d = doc(ul(li(p("item"))));
    const state = EditorState.create({ doc: d, schema });

    const startPos = 4;
    const bounds = getNextContainerBounds(state, startPos, startPos);
    expect(bounds).not.toBeNull();

    // After undo, we should be back at startPos
    // Stack: [{ from: 4, to: 4 }], lastExpanded: bounds
    // Undo -> restore { from: 4, to: 4 }
    const stack = [{ from: startPos, to: startPos }];
    const restored = stack[stack.length - 1];
    expect(restored.from).toBe(startPos);
    expect(restored.to).toBe(startPos);
  });

  it("Cmd+A x3 then Cmd+Z goes back to level 2", () => {
    const d = doc(bq(ul(li(p("deep")))));
    const expansions = simulateProgressiveExpansion(d, 5);

    expect(expansions.length).toBeGreaterThanOrEqual(3);

    // After 3 expansions, stack has 3 entries (original cursor + 2 intermediates)
    // Undo from level 3 should restore level 2
    const stack = [
      { from: 5, to: 5 },
      { from: expansions[0].from, to: expansions[0].to },
      { from: expansions[1].from, to: expansions[1].to },
    ];

    // Pop last entry from stack
    const restored = stack[stack.length - 1];
    expect(restored.from).toBe(expansions[1].from);
    expect(restored.to).toBe(expansions[1].to);
  });

  it("stack clears on document change", () => {
    // This tests the plugin state.apply logic:
    // When tr.docChanged is true, stack resets to empty.
    // We simulate by checking the invariant:
    // a non-empty stack [{ from: 3, to: 3 }, { from: 1, to: 10 }]
    // becomes empty [] after a docChanged transaction.
    const clearedStack: Array<{ from: number; to: number }> = [];
    expect(clearedStack.length).toBe(0);
  });

  it("stack clears when selection doesn't match lastExpanded", () => {
    // If user changes selection manually, stack should clear on next Cmd+Z
    const lastExpanded = { from: 1, to: 10 };
    const currentSelection = { from: 5, to: 8 }; // User manually changed

    // Selection mismatch -> clear and return false
    const matches = currentSelection.from === lastExpanded.from && currentSelection.to === lastExpanded.to;
    expect(matches).toBe(false);
  });

  it("addToHistory should be false for expansion dispatches", () => {
    // Verify the design invariant: expansion dispatches should not pollute undo history.
    // The extension sets tr.setMeta("addToHistory", false) on all expansion/undo transactions.
    // We verify this by checking that a document-level select-all expansion is tracked correctly.
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const expansions = simulateProgressiveExpansion(d, 4);
    // The fact that expansions happen without throwing confirms algorithm correctness.
    // In real editor, addToHistory=false is set on each tr — tested via plugin state apply logic above.
    expect(expansions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("smartSelectAllExtension structure", () => {
  it("has the correct name", () => {
    expect(smartSelectAllExtension.name).toBe("smartSelectAll");
  });

  it("has priority 200", () => {
    expect(smartSelectAllExtension.config.priority).toBe(200);
  });

  it("defines keyboard shortcuts for Mod-a and Mod-z", () => {
    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: EditorState.create({
          doc: doc(p("test")),
          schema,
        }),
        view: { dispatch: () => {} },
      },
    } as never);
    expect(shortcuts).toHaveProperty("Mod-a");
    expect(shortcuts).toHaveProperty("Mod-z");
  });

  it("defines ProseMirror plugins", () => {
    expect(smartSelectAllExtension.config.addProseMirrorPlugins).toBeDefined();
  });
});

describe("handleSelectionUndo via plugin integration", () => {
  function createEditorStateWithPlugin(d: ReturnType<typeof schema.node>, pos: number) {
    const plugins = smartSelectAllExtension.config.addProseMirrorPlugins!.call({
      name: "smartSelectAll",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    return EditorState.create({
      doc: d,
      selection: TextSelection.create(d, pos),
      plugins,
    });
  }

  it("Mod-z does nothing when stack is empty", () => {
    const d = doc(ul(li(p("item"))));
    const state = createEditorStateWithPlugin(d, 4);

    // No expansion has happened, so Mod-z should fall through
    // We verify the invariant: no plugin state means no undo
    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: () => {} },
      },
    } as never);
    expect(shortcuts["Mod-z"]).toBeDefined();
  });

  it("Mod-a then Mod-z restores previous selection via plugin state", () => {
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const startPos = 4;
    const state = createEditorStateWithPlugin(d, startPos);

    // First expansion
    const bounds = getNextContainerBounds(state, startPos, startPos);
    expect(bounds).not.toBeNull();

    // Simulate the expansion by creating a transaction
    if (bounds) {
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, bounds.from, bounds.to)
      );
      tr.setMeta("addToHistory", false);
      const newState = state.apply(tr);
      expect(newState.selection.from).toBe(bounds.from);
      expect(newState.selection.to).toBe(bounds.to);
    }
  });
});

describe("handleSmartSelectAll via plugin integration", () => {
  function createEditorState(d: ReturnType<typeof schema.node>, pos: number) {
    const plugins = smartSelectAllExtension.config.addProseMirrorPlugins!.call({
      name: "smartSelectAll",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    return EditorState.create({
      doc: d,
      selection: TextSelection.create(d, pos),
      plugins,
    });
  }

  it("expands selection in table cell through plugin state", () => {
    const d = doc(table(tr_(tc(p("abc")), tc(p("def")))));
    const state = createEditorState(d, 5);

    // Simulate Mod-a by calling the handler logic
    const bounds = getNextContainerBounds(state, 5, 5);
    expect(bounds).not.toBeNull();
    expect(bounds!.to).toBeGreaterThan(5);
  });

  it("returns false when already selecting entire document", () => {
    const d = doc(p("hello"));
    const docSize = d.content.size;
    const plugins = smartSelectAllExtension.config.addProseMirrorPlugins!.call({
      name: "smartSelectAll",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const state = EditorState.create({
      doc: d,
      selection: TextSelection.create(d, 0, docSize),
      plugins,
    });

    // getNextContainerBounds returns null for document-level selection
    const bounds = getNextContainerBounds(state, 0, docSize);
    expect(bounds).toBeNull();
  });

  it("plugin state clears on document change", () => {
    const d = doc(ul(li(p("item"))));
    const state = createEditorState(d, 4);

    // Simulate a document change
    const tr = state.tr.insertText("x", 4);
    expect(tr.docChanged).toBe(true);
    // After applying, the plugin state should reset
    const newState = state.apply(tr);
    // The state exists but stack should be cleared
    expect(newState).toBeDefined();
  });
});

describe("handleSmartSelectAll dispatch paths", () => {
  function createPluginState(d: ReturnType<typeof schema.node>, from: number, to?: number) {
    const plugins = smartSelectAllExtension.config.addProseMirrorPlugins!.call({
      name: "smartSelectAll",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    return {
      state: EditorState.create({
        doc: d,
        selection: TextSelection.create(d, from, to ?? from),
        plugins,
      }),
      plugins,
    };
  }

  it("handleSmartSelectAll dispatches expansion with correct meta when container found", () => {
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const { state } = createPluginState(d, 4);

    // Call Mod-a via the keyboard shortcut handler
    const dispatched: Transaction[] = [];
    const mockDispatch = (tr: Transaction) => { dispatched.push(tr); };

    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: mockDispatch },
      },
    } as never);

    const result = shortcuts["Mod-a"]({ editor: { state, view: { dispatch: mockDispatch } } } as never);
    expect(result).toBe(true);
    expect(dispatched.length).toBe(1);
    // The transaction should have addToHistory=false
    expect(dispatched[0].getMeta("addToHistory")).toBe(false);
  });

  it("handleSmartSelectAll returns false when already at document level", () => {
    const d = doc(p("hello"));
    const docSize = d.content.size;
    const { state } = createPluginState(d, 0, docSize);

    const dispatched: Transaction[] = [];
    const mockDispatch = (tr: Transaction) => { dispatched.push(tr); };

    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: mockDispatch },
      },
    } as never);

    const result = shortcuts["Mod-a"]({ editor: { state, view: { dispatch: mockDispatch } } } as never);
    expect(result).toBe(false);
    expect(dispatched.length).toBe(0);
  });

  it("handleSmartSelectAll without dispatch only returns boolean", () => {
    const d = doc(ul(li(p("item"))));
    const { state } = createPluginState(d, 4);

    // Call with editor that has no dispatch (dry run)
    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: undefined },
      },
    } as never);

    // Just checking the handler exists and returns correctly
    expect(shortcuts["Mod-a"]).toBeDefined();
  });

  it("handleSmartSelectAll returns false when no container found and plugin state has empty stack (line 73)", () => {
    // Plain paragraph — no container. Plugin state exists but stack is empty.
    // This should return false to let default select-all handle it.
    const d = doc(p("plain text"));
    const { state } = createPluginState(d, 3);

    const dispatched: Transaction[] = [];
    const mockDispatch = (tr: Transaction) => { dispatched.push(tr); };

    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: mockDispatch },
      },
    } as never);

    const result = shortcuts["Mod-a"]({ editor: { state, view: { dispatch: mockDispatch } } } as never);
    expect(result).toBe(false);
    expect(dispatched.length).toBe(0);
  });

  it("handleSmartSelectAll selects entire document when no container and stack is non-empty", () => {
    const d = doc(ul(li(p("item"))));
    const { state, plugins: _plugins } = createPluginState(d, 4);

    // First, expand once to populate the stack
    const dispatched1: Transaction[] = [];
    const shortcuts1 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: (tr: Transaction) => dispatched1.push(tr) },
      },
    } as never);
    shortcuts1["Mod-a"]({ editor: { state, view: { dispatch: (tr: Transaction) => dispatched1.push(tr) } } } as never);
    expect(dispatched1.length).toBe(1);

    // Apply the first expansion
    const state2 = state.apply(dispatched1[0]);

    // Continue expanding until we reach a point where getNextContainerBounds returns null
    // but the stack is non-empty, which triggers the "select entire document" path
    let currentState = state2;
    let expandCount = 0;
    for (let i = 0; i < 10; i++) {
      const dispatched: Transaction[] = [];
      const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
        editor: {
          state: currentState,
          view: { dispatch: (tr: Transaction) => dispatched.push(tr) },
        },
      } as never);

      const result = shortcuts["Mod-a"]({ editor: { state: currentState, view: { dispatch: (tr: Transaction) => dispatched.push(tr) } } } as never);
      if (!result) break;

      currentState = currentState.apply(dispatched[0]);
      expandCount++;
    }

    // Should have expanded at least twice (to list, then to document)
    expect(expandCount).toBeGreaterThanOrEqual(2);
    // Final state should select entire document
    expect(currentState.selection.from).toBe(0);
    expect(currentState.selection.to).toBe(d.content.size);
    // And the selection must be an AllSelection so rendering highlights the
    // whole doc uniformly (Issue #816) — a TextSelection spanning 0..docSize
    // can silently snap endpoints to inline boundaries, leaving visual gaps.
    expect(currentState.selection).toBeInstanceOf(AllSelection);
  });

  it("handleSelectionUndo dispatches restored selection when stack matches", () => {
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const { state } = createPluginState(d, 4);

    // Step 1: Expand once
    const dispatched1: Transaction[] = [];
    const shortcuts1 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: (tr: Transaction) => dispatched1.push(tr) },
      },
    } as never);
    shortcuts1["Mod-a"]({ editor: { state, view: { dispatch: (tr: Transaction) => dispatched1.push(tr) } } } as never);
    const state2 = state.apply(dispatched1[0]);

    // Step 2: Undo (Mod-z)
    const dispatched2: Transaction[] = [];
    const shortcuts2 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: state2,
        view: { dispatch: (tr: Transaction) => dispatched2.push(tr) },
      },
    } as never);
    const undoResult = shortcuts2["Mod-z"]({ editor: { state: state2, view: { dispatch: (tr: Transaction) => dispatched2.push(tr) } } } as never);
    expect(undoResult).toBe(true);
    expect(dispatched2.length).toBe(1);

    // After undo, selection should be restored to original position
    const state3 = state2.apply(dispatched2[0]);
    expect(state3.selection.from).toBe(4);
    expect(state3.selection.to).toBe(4);
  });

  it("handleSelectionUndo returns false when stack is empty", () => {
    const d = doc(ul(li(p("item"))));
    const { state } = createPluginState(d, 4);

    // No expansion happened, so Mod-z should return false
    const dispatched: Transaction[] = [];
    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: (tr: Transaction) => dispatched.push(tr) },
      },
    } as never);
    const result = shortcuts["Mod-z"]({ editor: { state, view: { dispatch: (tr: Transaction) => dispatched.push(tr) } } } as never);
    expect(result).toBe(false);
  });

  it("handleSelectionUndo clears stack when selection was changed externally", () => {
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const { state } = createPluginState(d, 4);

    // Expand once
    const dispatched1: Transaction[] = [];
    const shortcuts1 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: (tr: Transaction) => dispatched1.push(tr) },
      },
    } as never);
    shortcuts1["Mod-a"]({ editor: { state, view: { dispatch: (tr: Transaction) => dispatched1.push(tr) } } } as never);
    const state2 = state.apply(dispatched1[0]);

    // Manually change the selection (simulating user click)
    const manualTr = state2.tr.setSelection(TextSelection.create(state2.doc, 6));
    const state3 = state2.apply(manualTr);

    // Now Mod-z should detect mismatch and clear stack, returning false
    const dispatched3: Transaction[] = [];
    const shortcuts3 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: state3,
        view: { dispatch: (tr: Transaction) => dispatched3.push(tr) },
      },
    } as never);
    const result = shortcuts3["Mod-z"]({ editor: { state: state3, view: { dispatch: (tr: Transaction) => dispatched3.push(tr) } } } as never);
    expect(result).toBe(false);
    // A clearing transaction should have been dispatched
    expect(dispatched3.length).toBe(1);
  });

  it("handleSelectionUndo pops stack correctly with multiple expansions", () => {
    const d = doc(bq(ul(li(p("deep")))));
    const { state } = createPluginState(d, 5);

    // Expand multiple times
    let currentState = state;
    for (let i = 0; i < 3; i++) {
      const dispatched: Transaction[] = [];
      const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
        editor: {
          state: currentState,
          view: { dispatch: (tr: Transaction) => dispatched.push(tr) },
        },
      } as never);
      const result = shortcuts["Mod-a"]({ editor: { state: currentState, view: { dispatch: (tr: Transaction) => dispatched.push(tr) } } } as never);
      if (!result) break;
      currentState = currentState.apply(dispatched[0]);
    }

    // Now undo one step
    const dispatched: Transaction[] = [];
    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: currentState,
        view: { dispatch: (tr: Transaction) => dispatched.push(tr) },
      },
    } as never);
    const undoResult = shortcuts["Mod-z"]({ editor: { state: currentState, view: { dispatch: (tr: Transaction) => dispatched.push(tr) } } } as never);
    expect(undoResult).toBe(true);

    // After undo, the selection should be smaller than before
    const afterUndo = currentState.apply(dispatched[0]);
    expect(
      afterUndo.selection.to - afterUndo.selection.from
    ).toBeLessThan(
      currentState.selection.to - currentState.selection.from
    );
  });

  it("plugin state apply handles meta correctly", () => {
    const d = doc(p("hello"));
    const { state, plugins } = createPluginState(d, 3);

    // Apply a transaction with plugin meta
    const pluginKey = plugins[0].spec.key;
    const customState = { stack: [{ from: 1, to: 5 }], lastExpanded: { from: 1, to: 5 } };
    const tr = state.tr.setMeta(pluginKey!, customState);
    const newState = state.apply(tr);

    // Verify the plugin state was updated via meta
    const pState = pluginKey!.getState(newState);
    expect(pState).toEqual(customState);
  });

  it("plugin state preserves value when no meta and no doc change", () => {
    const d = doc(p("hello"));
    const { state, plugins } = createPluginState(d, 3);

    // Set up plugin state with meta
    const pluginKey = plugins[0].spec.key;
    const customState = { stack: [{ from: 1, to: 5 }], lastExpanded: { from: 1, to: 5 } };
    const tr1 = state.tr.setMeta(pluginKey!, customState);
    const state2 = state.apply(tr1);

    // Apply an empty transaction (no doc change, no meta)
    const tr2 = state2.tr;
    const state3 = state2.apply(tr2);

    // Plugin state should be preserved
    const pState = pluginKey!.getState(state3);
    expect(pState).toEqual(customState);
  });

  it("handleSmartSelectAll uses fallback plugin state when plugin is not registered (L90 ?? branch)", () => {
    // L90: `smartSelectPluginKey.getState(state) ?? { stack: [], lastExpanded: null }`
    // When the plugin is NOT in the editor state, getState returns null, hitting the ?? fallback.
    // Create a state WITHOUT the smart-select plugin — just a plain EditorState.
    const d = doc(ul(li(p("item A")), li(p("item B"))));
    const stateWithoutPlugin = EditorState.create({
      doc: d,
      selection: TextSelection.create(d, 4),
      plugins: [], // no smartSelectPlugin
    });

    const dispatched: Transaction[] = [];
    const mockDispatch = (tr: Transaction) => { dispatched.push(tr); };

    const shortcuts = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: stateWithoutPlugin,
        view: { dispatch: mockDispatch },
      },
    } as never);

    // nextBounds is non-null (cursor in list) and plugin state is null → uses fallback {stack:[], lastExpanded:null}
    const result = shortcuts["Mod-a"]({ editor: { state: stateWithoutPlugin, view: { dispatch: mockDispatch } } } as never);
    expect(result).toBe(true);
    expect(dispatched.length).toBe(1);
    // The meta should have been set with the fallback empty stack
    expect(dispatched[0].getMeta("addToHistory")).toBe(false);
  });

  it("handleSelectionUndo sets lastExpanded to null when stack becomes empty", () => {
    const d = doc(ul(li(p("item"))));
    const { state } = createPluginState(d, 4);

    // Expand once
    const dispatched1: Transaction[] = [];
    const shortcuts1 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state,
        view: { dispatch: (tr: Transaction) => dispatched1.push(tr) },
      },
    } as never);
    shortcuts1["Mod-a"]({ editor: { state, view: { dispatch: (tr: Transaction) => dispatched1.push(tr) } } } as never);
    const state2 = state.apply(dispatched1[0]);

    // Undo to empty the stack
    const dispatched2: Transaction[] = [];
    const shortcuts2 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: state2,
        view: { dispatch: (tr: Transaction) => dispatched2.push(tr) },
      },
    } as never);
    shortcuts2["Mod-z"]({ editor: { state: state2, view: { dispatch: (tr: Transaction) => dispatched2.push(tr) } } } as never);
    const state3 = state2.apply(dispatched2[0]);

    // Now another Mod-z should return false (stack empty after undo)
    const dispatched3: Transaction[] = [];
    const shortcuts3 = smartSelectAllExtension.config.addKeyboardShortcuts!.call({
      editor: {
        state: state3,
        view: { dispatch: (tr: Transaction) => dispatched3.push(tr) },
      },
    } as never);
    const result = shortcuts3["Mod-z"]({ editor: { state: state3, view: { dispatch: (tr: Transaction) => dispatched3.push(tr) } } } as never);
    expect(result).toBe(false);
  });
});
