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

import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useLintStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { LintExtension } from "./tiptap";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import {
  schema,
  makePara,
  makeDoc,
  makeDiagnostic,
  getPlugins,
  setLintEnabled,
} from "./__tests__/testHarness";
import { bumpLintDocEpoch, markLintRunStart } from "./docEpoch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LintExtension", () => {
  beforeEach(() => {
    bindPluginHostSettings();
    useLintStore.setState({ diagnosticsByTab: {}, selectedIndexByTab: {} });
    setLintEnabled(true);
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
      expect(defaults).toMatchObject({ tabId: "" });
      // The default source reports nothing rather than reaching a store.
      const { diagnostics } = defaults as {
        diagnostics: { get: (t: string) => unknown[]; subscribe: () => () => void };
      };
      expect(diagnostics.get("any-tab")).toEqual([]);
      expect(typeof diagnostics.subscribe(() => {})).toBe("function");
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

    it("returns empty decorations when the recorded lint run is stale (verify P7)", () => {
      // A remount (mode switch) must not repaint diagnostics computed
      // before the last doc change: run recorded, then the doc changed.
      const tabId = "tab-init-stale";
      useLintStore.setState({
        diagnosticsByTab: { [tabId]: [makeDiagnostic({ line: 1 })] },
      });
      markLintRunStart(tabId);
      bumpLintDocEpoch(tabId);

      const doc = makeDoc(makePara("hello"));
      const plugin = getPlugins(tabId)[0];
      const decoSet = plugin.spec.state!.init!({} as never, { doc } as never);
      expect(decoSet).toBe(DecorationSet.empty);
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

      // Set diagnostics — serialized source is "hello\n\nworld\n", so the
      // second paragraph is on line 3 (line 2 is the blank separator).
      useLintStore.setState({
        diagnosticsByTab: {
          "tab-1": [makeDiagnostic({ line: 3, severity: "warning" })],
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
  // Doc-epoch guard — stale async completions (Codex audit finding 5)
  // -----------------------------------------------------------------------
  describe("doc-epoch guard for stale async lint completions", () => {
    // NOTE: each test uses a UNIQUE tabId — the epoch registry is
    // module-level, so sharing "tab-1" would leak guard state into the
    // unrelated tests above.

    it("drops a diagnosticsChanged rebuild when the doc changed after the lint run started", () => {
      const tabId = "epoch-tab-stale";
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins(tabId);
      const state = EditorState.create({ doc, schema, plugins });

      // Lint run captures its content NOW …
      markLintRunStart(tabId);

      // … then the user edits before the async link check completes.
      // Applying through the state runs the plugin's apply(), which must
      // bump the tab's doc epoch.
      const edited = state.apply(state.tr.insertText("x", 1));

      // The stale completion arrives and triggers a rebuild.
      useLintStore.setState({
        diagnosticsByTab: { [tabId]: [makeDiagnostic({ line: 1 })] },
      });
      const pluginKey = state.plugins[0].spec.key!;
      const tr = edited.tr.setMeta(pluginKey, "diagnosticsChanged");
      const decos = state.plugins[0].spec.state!.apply!(
        tr,
        DecorationSet.empty,
        edited,
        edited
      );
      // Stale lines must NOT be mapped onto the edited doc.
      expect(decos).toBe(DecorationSet.empty);
    });

    it("rebuilds normally when the doc has not changed since the run started", () => {
      const tabId = "epoch-tab-fresh";
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins(tabId);
      const state = EditorState.create({ doc, schema, plugins });

      markLintRunStart(tabId);
      useLintStore.setState({
        diagnosticsByTab: { [tabId]: [makeDiagnostic({ line: 1 })] },
      });
      const pluginKey = state.plugins[0].spec.key!;
      const tr = state.tr.setMeta(pluginKey, "diagnosticsChanged");
      const decos = state.plugins[0].spec.state!.apply!(
        tr,
        DecorationSet.empty,
        state,
        state
      );
      expect(decos.find()).toHaveLength(1);
    });

    it("rebuilds after an edit when a NEW run started post-edit (re-run picks up fresh content)", () => {
      const tabId = "epoch-tab-rerun";
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins(tabId);
      const state = EditorState.create({ doc, schema, plugins });

      markLintRunStart(tabId);
      const edited = state.apply(state.tr.insertText("x", 1));
      // User re-runs lint after the edit — new snapshot, fresh content.
      markLintRunStart(tabId);

      useLintStore.setState({
        diagnosticsByTab: { [tabId]: [makeDiagnostic({ line: 1 })] },
      });
      const pluginKey = state.plugins[0].spec.key!;
      const tr = edited.tr.setMeta(pluginKey, "diagnosticsChanged");
      const decos = state.plugins[0].spec.state!.apply!(
        tr,
        DecorationSet.empty,
        edited,
        edited
      );
      expect(decos.find()).toHaveLength(1);
    });

    it("rebuilds when no run start was ever recorded for the tab (foreign callers)", () => {
      const tabId = "epoch-tab-foreign";
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins(tabId);
      const state = EditorState.create({ doc, schema, plugins });

      // Edit bumps the epoch, but no run start was recorded — guard stays open.
      const edited = state.apply(state.tr.insertText("x", 1));
      useLintStore.setState({
        diagnosticsByTab: { [tabId]: [makeDiagnostic({ line: 1 })] },
      });
      const pluginKey = state.plugins[0].spec.key!;
      const tr = edited.tr.setMeta(pluginKey, "diagnosticsChanged");
      const decos = state.plugins[0].spec.state!.apply!(
        tr,
        DecorationSet.empty,
        edited,
        edited
      );
      expect(decos.find()).toHaveLength(1);
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
  // Live lint toggle — decorations gated on markdown.lintEnabled (#audit)
  // -----------------------------------------------------------------------
  describe("live lintEnabled toggle", () => {
    it("state.init returns empty decorations when lint is disabled, even with diagnostics", () => {
      setLintEnabled(false);
      // Set diagnostics AFTER disabling (disabling clears the store via the
      // lint.ts module subscription, so order matters here).
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": [makeDiagnostic({ line: 1 })] },
      });

      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const decoSet = plugins[0].spec.state!.init!({} as never, { doc } as never);
      expect(decoSet).toBe(DecorationSet.empty);
    });

    it("apply(diagnosticsChanged) returns empty decorations when lint is disabled", () => {
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const state = EditorState.create({ doc, schema, plugins });

      setLintEnabled(false);
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": [makeDiagnostic({ line: 1 })] },
      });

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

    it("dispatches a rebuild when lintEnabled is toggled off (clears stale decorations live)", () => {
      const plugins = getPlugins("tab-1");
      const plugin = plugins[0];
      const doc = makeDoc(makePara("hello"));
      const dispatchMock = vi.fn();
      const mockView = {
        state: EditorState.create({ doc, schema, plugins }),
        dispatch: dispatchMock,
        composing: false,
      } as unknown;
      const viewFactory = plugin.spec.view as (
        view: unknown
      ) => { destroy: () => void };
      const viewInstance = viewFactory(mockView);

      // Toggling the setting OFF must trigger a re-dispatch so apply()
      // rebuilds (to empty) — without it, stale decorations linger until the
      // next doc edit or remount.
      setLintEnabled(false);
      expect(dispatchMock).toHaveBeenCalledTimes(1);

      // Toggling back ON re-dispatches again (rebuild from current store).
      setLintEnabled(true);
      expect(dispatchMock).toHaveBeenCalledTimes(2);

      // After destroy, further toggles are ignored.
      viewInstance.destroy();
      setLintEnabled(false);
      expect(dispatchMock).toHaveBeenCalledTimes(2);
    });

    it("does not dispatch when an unrelated settings change fires", () => {
      const plugins = getPlugins("tab-1");
      const plugin = plugins[0];
      const doc = makeDoc(makePara("hello"));
      const dispatchMock = vi.fn();
      const mockView = {
        state: EditorState.create({ doc, schema, plugins }),
        dispatch: dispatchMock,
        composing: false,
      } as unknown;
      const viewFactory = plugin.spec.view as (
        view: unknown
      ) => { destroy: () => void };
      const viewInstance = viewFactory(mockView);

      // Same lintEnabled value — no rebuild dispatch.
      useSettingsStore.setState((s) => ({ markdown: { ...s.markdown } }));
      expect(dispatchMock).not.toHaveBeenCalled();

      viewInstance.destroy();
    });
  });
});
