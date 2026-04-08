/**
 * Tests for the Tiptap lint extension (tiptap.ts).
 *
 * Covers: buildDecorations (with line-to-block mapping), LintExtension options,
 * addProseMirrorPlugins, plugin state (init/apply), view subscription,
 * and props.decorations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock CSS import before importing the module under test
vi.mock("./lint.css", () => ({}));

// Mock imeGuard — we need to control runOrQueueProseMirrorAction
const mockRunOrQueue = vi.fn((_, action: () => void) => action());
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: (...args: unknown[]) =>
    mockRunOrQueue(...args),
}));

import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useLintStore } from "@/stores/lintStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";
import { LintExtension } from "./tiptap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    codeBlock: {
      group: "block",
      content: "text*",
      code: true,
    },
    text: { group: "inline" },
  },
  marks: {},
});

function makePara(text: string): PMNode {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

function makeHeading(text: string, level = 1): PMNode {
  return schema.node("heading", { level }, text ? [schema.text(text)] : []);
}

function makeCode(text: string): PMNode {
  return schema.node("codeBlock", null, text ? [schema.text(text)] : []);
}

function makeDoc(...blocks: PMNode[]): PMNode {
  return schema.node("doc", null, blocks);
}

function makeDiagnostic(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return {
    id: "E01-1-1",
    ruleId: "E01",
    severity: "warning",
    messageKey: "lint.E01",
    messageParams: {},
    line: 1,
    column: 1,
    offset: 0,
    uiHint: "block",
    ...overrides,
  };
}

/**
 * Invoke addProseMirrorPlugins on the LintExtension with a given tabId.
 * Returns the array of ProseMirror plugins.
 */
function getPlugins(tabId: string) {
  return LintExtension.config.addProseMirrorPlugins!.call({
    name: "markdownLint",
    options: { tabId },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LintExtension", () => {
  beforeEach(() => {
    useLintStore.setState({ diagnosticsByTab: {}, selectedIndexByTab: {} });
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Extension metadata & options
  // -----------------------------------------------------------------------
  describe("extension metadata", () => {
    it("has the correct name", () => {
      expect(LintExtension.name).toBe("markdownLint");
    });

    it("defines addProseMirrorPlugins", () => {
      expect(LintExtension.config.addProseMirrorPlugins).toBeDefined();
    });

    it("has default tabId as empty string", () => {
      const defaults = LintExtension.config.addOptions!.call({
        name: "markdownLint",
        options: {},
        storage: {},
        parent: null as never,
        editor: {} as never,
        type: "extension" as never,
      });
      expect(defaults).toEqual({ tabId: "" });
    });
  });

  // -----------------------------------------------------------------------
  // addProseMirrorPlugins — tabId gate
  // -----------------------------------------------------------------------
  describe("addProseMirrorPlugins", () => {
    it("returns empty array when tabId is empty string", () => {
      const plugins = getPlugins("");
      expect(plugins).toEqual([]);
    });

    it("returns one plugin when tabId is non-empty", () => {
      const plugins = getPlugins("tab-1");
      expect(plugins).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin state — init
  // -----------------------------------------------------------------------
  describe("plugin state.init", () => {
    it("returns empty decorations when no diagnostics in store", () => {
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const plugin = plugins[0];

      const decoSet = plugin.spec.state!.init!({} as never, { doc } as never);
      expect(decoSet).toBe(DecorationSet.empty);
    });

    it("builds decorations when diagnostics exist in store", () => {
      useLintStore.setState({
        diagnosticsByTab: {
          "tab-1": [makeDiagnostic({ line: 1, severity: "error" })],
        },
      });

      const doc = makeDoc(makePara("hello"), makePara("world"));
      const plugins = getPlugins("tab-1");
      const plugin = plugins[0];

      const decoSet = plugin.spec.state!.init!({} as never, { doc } as never);
      expect(decoSet).not.toBe(DecorationSet.empty);

      // Verify the decoration has the error class
      const decos = decoSet.find();
      expect(decos).toHaveLength(1);
    });

    it("uses empty array fallback when tab has no entry in store", () => {
      useLintStore.setState({
        diagnosticsByTab: { "tab-other": [makeDiagnostic()] },
      });

      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const plugin = plugins[0];

      const decoSet = plugin.spec.state!.init!({} as never, { doc } as never);
      expect(decoSet).toBe(DecorationSet.empty);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin state — apply
  // -----------------------------------------------------------------------
  describe("plugin state.apply", () => {
    function createEditorState(doc: PMNode, tabId: string) {
      const plugins = getPlugins(tabId);
      return EditorState.create({ doc, schema, plugins });
    }

    it("returns DecorationSet.empty when document changes", () => {
      const doc = makeDoc(makePara("hello"));
      const state = createEditorState(doc, "tab-1");

      // Create a transaction that changes the document
      const tr = state.tr.insertText(" world", 6);
      expect(tr.docChanged).toBe(true);

      const plugin = state.plugins[0];
      const oldDecos = plugin.spec.state!.init!({} as never, { doc } as never);
      const newDecos = plugin.spec.state!.apply!(tr, oldDecos, state, state);
      expect(newDecos).toBe(DecorationSet.empty);
    });

    it("rebuilds decorations when meta is 'diagnosticsChanged'", () => {
      const doc = makeDoc(makePara("hello"), makePara("world"));
      const state = createEditorState(doc, "tab-1");

      // Set diagnostics
      useLintStore.setState({
        diagnosticsByTab: {
          "tab-1": [makeDiagnostic({ line: 2, severity: "warning" })],
        },
      });

      // Create a non-doc-changing transaction with the meta key
      const pluginKey = state.plugins[0].spec.key!;
      const tr = state.tr.setMeta(pluginKey, "diagnosticsChanged");
      expect(tr.docChanged).toBe(false);

      const oldDecos = DecorationSet.empty;
      const newDecos = state.plugins[0].spec.state!.apply!(
        tr,
        oldDecos,
        state,
        state
      );
      expect(newDecos).not.toBe(DecorationSet.empty);
      expect(newDecos.find()).toHaveLength(1);
    });

    it("remaps existing decorations for non-doc-changing transactions without meta", () => {
      const doc = makeDoc(makePara("hello"));
      const state = createEditorState(doc, "tab-1");

      // Non-doc-changing, no meta
      const tr = state.tr;
      expect(tr.docChanged).toBe(false);

      const oldDecos = DecorationSet.empty;
      const newDecos = state.plugins[0].spec.state!.apply!(
        tr,
        oldDecos,
        state,
        state
      );
      // Should be remapped (for empty set, it stays empty)
      expect(newDecos).toBeDefined();
    });

    it("returns empty when meta is set but diagnostics list is empty", () => {
      const doc = makeDoc(makePara("hello"));
      const state = createEditorState(doc, "tab-1");

      // No diagnostics in store for this tab
      const pluginKey = state.plugins[0].spec.key!;
      const tr = state.tr.setMeta(pluginKey, "diagnosticsChanged");

      const newDecos = state.plugins[0].spec.state!.apply!(
        tr,
        DecorationSet.empty,
        state,
        state
      );
      expect(newDecos).toBe(DecorationSet.empty);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin props.decorations
  // -----------------------------------------------------------------------
  describe("plugin props.decorations", () => {
    it("returns the plugin state as decorations", () => {
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const state = EditorState.create({ doc, schema, plugins });

      const plugin = plugins[0];
      const result = plugin.spec.props!.decorations!(state);
      // Should be whatever the plugin state is (DecorationSet.empty for no diagnostics)
      expect(result).toBe(DecorationSet.empty);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin view — store subscription
  // -----------------------------------------------------------------------
  describe("plugin view subscription", () => {
    // We need to invoke the view factory manually
    function createViewSetup(tabId: string) {
      const plugins = getPlugins(tabId);
      const plugin = plugins[0];
      const doc = makeDoc(makePara("hello"));

      // Create a mock editor view
      const dispatchMock = vi.fn();
      const mockView = {
        state: EditorState.create({ doc, schema, plugins }),
        dispatch: dispatchMock,
        composing: false,
      } as unknown;

      // Invoke the view factory
      const viewFactory = plugin.spec.view as (
        view: unknown
      ) => { destroy: () => void };
      const viewInstance = viewFactory(mockView);

      return { viewInstance, dispatchMock, mockView };
    }

    it("subscribes to lintStore on creation", () => {
      const subscribeSpy = vi.spyOn(useLintStore, "subscribe");
      createViewSetup("tab-1");
      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      subscribeSpy.mockRestore();
    });

    it("unsubscribes on destroy", () => {
      const unsubMock = vi.fn();
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockReturnValue(unsubMock);

      const { viewInstance } = createViewSetup("tab-1");
      viewInstance.destroy();
      expect(unsubMock).toHaveBeenCalledTimes(1);

      subscribeSpy.mockRestore();
    });

    it("dispatches when diagnostics change to non-empty", () => {
      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");

      // Simulate store change with new diagnostics
      const newDiags = [makeDiagnostic()];
      subscribeCb!({
        diagnosticsByTab: { "tab-1": newDiags },
      });

      // runOrQueueProseMirrorAction should have been called
      expect(mockRunOrQueue).toHaveBeenCalled();
      // Which in turn calls dispatch
      expect(dispatchMock).toHaveBeenCalled();

      subscribeSpy.mockRestore();
    });

    it("does NOT dispatch when diagnostics are cleared (empty array)", () => {
      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");

      // Simulate store change with cleared diagnostics
      subscribeCb!({
        diagnosticsByTab: { "tab-1": [] },
      });

      expect(dispatchMock).not.toHaveBeenCalled();

      subscribeSpy.mockRestore();
    });

    it("does NOT dispatch when diagnostics are undefined (removed)", () => {
      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");

      subscribeCb!({ diagnosticsByTab: {} });
      expect(dispatchMock).not.toHaveBeenCalled();

      subscribeSpy.mockRestore();
    });

    it("does NOT dispatch when diagnostics reference is the same", () => {
      const sameDiags = [makeDiagnostic()];
      // Set initial diagnostics so prevDiagnostics matches
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": sameDiags },
      });

      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");

      // Same reference
      subscribeCb!({
        diagnosticsByTab: { "tab-1": sameDiags },
      });

      expect(dispatchMock).not.toHaveBeenCalled();

      subscribeSpy.mockRestore();
    });

    it("does NOT dispatch after destroy", () => {
      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { viewInstance, dispatchMock } = createViewSetup("tab-1");

      // Destroy first
      viewInstance.destroy();

      // Then simulate diagnostics arriving
      subscribeCb!({
        diagnosticsByTab: { "tab-1": [makeDiagnostic()] },
      });

      expect(dispatchMock).not.toHaveBeenCalled();

      subscribeSpy.mockRestore();
    });

    it("does NOT dispatch inside runOrQueue callback after destroy", () => {
      // Test the inner destroyed check inside the runOrQueue callback
      let subscribeCb: ((state: unknown) => void) | undefined;
      let capturedAction: (() => void) | undefined;

      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      // Override mockRunOrQueue to capture the action but not execute it
      mockRunOrQueue.mockImplementation((_view, action: () => void) => {
        capturedAction = action;
      });

      const { viewInstance, dispatchMock } = createViewSetup("tab-1");

      // Trigger a diagnostics change (will capture the action)
      subscribeCb!({
        diagnosticsByTab: { "tab-1": [makeDiagnostic()] },
      });
      expect(capturedAction).toBeDefined();

      // Destroy before the action runs
      viewInstance.destroy();

      // Now execute the captured action — should be a no-op
      capturedAction!();
      expect(dispatchMock).not.toHaveBeenCalled();

      subscribeSpy.mockRestore();
      // Restore the default behavior
      mockRunOrQueue.mockImplementation((_, action: () => void) => action());
    });

    it("updates prevDiagnostics when diagnostics change", () => {
      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");
      mockRunOrQueue.mockClear();
      dispatchMock.mockClear();

      const firstDiags = [makeDiagnostic()];
      subscribeCb!({
        diagnosticsByTab: { "tab-1": firstDiags },
      });
      expect(mockRunOrQueue).toHaveBeenCalledTimes(1);

      // Same reference again should NOT dispatch
      mockRunOrQueue.mockClear();
      subscribeCb!({
        diagnosticsByTab: { "tab-1": firstDiags },
      });
      expect(mockRunOrQueue).not.toHaveBeenCalled();

      // New reference should dispatch
      const secondDiags = [makeDiagnostic({ line: 2 })];
      subscribeCb!({
        diagnosticsByTab: { "tab-1": secondDiags },
      });
      expect(mockRunOrQueue).toHaveBeenCalledTimes(1);

      subscribeSpy.mockRestore();
    });

    it("updates prevDiagnostics even when clearing (no dispatch but ref updated)", () => {
      const initialDiags = [makeDiagnostic()];
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": initialDiags },
      });

      let subscribeCb: ((state: unknown) => void) | undefined;
      const subscribeSpy = vi
        .spyOn(useLintStore, "subscribe")
        .mockImplementation((cb) => {
          subscribeCb = cb as (state: unknown) => void;
          return vi.fn();
        });

      const { dispatchMock } = createViewSetup("tab-1");
      mockRunOrQueue.mockClear();
      dispatchMock.mockClear();

      // Clear diagnostics (empty array)
      subscribeCb!({
        diagnosticsByTab: { "tab-1": [] },
      });
      expect(dispatchMock).not.toHaveBeenCalled();

      // Now set new diagnostics — should dispatch because prev was updated to []
      const newDiags = [makeDiagnostic()];
      subscribeCb!({
        diagnosticsByTab: { "tab-1": newDiags },
      });
      expect(mockRunOrQueue).toHaveBeenCalledTimes(1);

      subscribeSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // buildDecorations — via plugin state.init (tests the private function)
  // -----------------------------------------------------------------------
  describe("buildDecorations (via state.init)", () => {
    function getDecorations(doc: PMNode, diagnostics: LintDiagnostic[]) {
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": diagnostics },
      });
      const plugins = getPlugins("tab-1");
      return plugins[0].spec.state!.init!({} as never, { doc } as never);
    }

    it("returns empty for null/undefined diagnostics", () => {
      useLintStore.setState({ diagnosticsByTab: {} });
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const result = plugins[0].spec.state!.init!({} as never, { doc } as never);
      expect(result).toBe(DecorationSet.empty);
    });

    it("returns empty for empty diagnostics array", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, []);
      expect(result).toBe(DecorationSet.empty);
    });

    it("skips sourceOnly diagnostics", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ uiHint: "sourceOnly", line: 1 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("creates lint-block-error class for error severity", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ severity: "error", line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // Decoration.node stores spec in the decoration
      expect((decos[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
        "lint-block-error"
      );
    });

    it("creates lint-block-warning class for warning severity", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ severity: "warning", line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      expect((decos[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
        "lint-block-warning"
      );
    });

    it("skips diagnostics with line beyond document range", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 99 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("maps diagnostics to correct blocks in multi-block doc", () => {
      const doc = makeDoc(
        makeHeading("Title"),
        makePara("paragraph one"),
        makePara("paragraph two")
      );
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 2, severity: "warning" }),
        makeDiagnostic({ line: 3, severity: "error", id: "E02-3-1" }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(2);
    });

    it("handles mixed diagnostics (valid, sourceOnly, out-of-range)", () => {
      const doc = makeDoc(makePara("hello"), makePara("world"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1, severity: "warning" }),
        makeDiagnostic({ line: 1, uiHint: "sourceOnly", id: "E08-1-1" }),
        makeDiagnostic({ line: 99, id: "W01-99-1" }),
        makeDiagnostic({ line: 2, severity: "error", id: "E02-2-1" }),
      ]);
      const decos = result.find();
      // Only line 1 warning and line 2 error should produce decorations
      expect(decos).toHaveLength(2);
    });

    it("handles exact and block uiHints the same way", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1, uiHint: "exact" }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Line-to-block mapping — via buildDecorations (tested indirectly)
  // -----------------------------------------------------------------------
  describe("line-to-block mapping (indirect via buildDecorations)", () => {
    function getDecorations(doc: PMNode, diagnostics: LintDiagnostic[]) {
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": diagnostics },
      });
      const plugins = getPlugins("tab-1");
      return plugins[0].spec.state!.init!({} as never, { doc } as never);
    }

    it("maps line 1 to first block", () => {
      const doc = makeDoc(makePara("first"), makePara("second"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // First paragraph starts at pos 0 (doc offset)
      expect(decos[0].from).toBe(0);
    });

    it("maps line 2 to second block", () => {
      const doc = makeDoc(makePara("first"), makePara("second"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 2 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // Second paragraph starts after first paragraph's nodeSize
      const firstBlockSize = doc.child(0).nodeSize;
      expect(decos[0].from).toBe(firstBlockSize);
    });

    it("handles code block with multi-line content", () => {
      // A code block with "line1\nline2\nline3" is still one block,
      // but the line-to-block mapping counts newlines within it
      const doc = makeDoc(
        makePara("intro"),
        makeCode("line1\nline2\nline3")
      );
      // Line 1 = first block (intro para)
      // Lines 2-4 span the code block (3 lines within it)
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 3 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // Should map to the code block
      const firstBlockSize = doc.child(0).nodeSize;
      expect(decos[0].from).toBe(firstBlockSize);
    });

    it("returns no decoration for line 0 (invalid)", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 0 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("returns no decoration for negative line number", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: -1 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("handles single-block document correctly", () => {
      const doc = makeDoc(makePara("only block"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
    });

    it("returns no decoration when target line exceeds block count (no newlines)", () => {
      const doc = makeDoc(makePara("a"), makePara("b"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 5 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });
  });
});
