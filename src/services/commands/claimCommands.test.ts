// @vitest-environment node
// WI-2b.6 — claim commands: panel toggle + extract-from-selection with
// provenance (the only claim-creation entry point, D2.2).
import { beforeEach, describe, expect, it } from "vitest";

import { registerClaimCommands } from "./claimCommands";
import { executeCommand, hasCommand, searchCommands } from "./CommandBus";
import { useClaimStore } from "@/stores/claimStore";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

function mockEditorWithSelection(text: string, tabId?: string) {
  const editor = {
    state: {
      // `empty` is what the availability predicate reads (audit #885) — an
      // O(1) test the palette can afford on every keystroke. Model it the way
      // ProseMirror does, or the fake answers a question the real one does not.
      selection: { from: 1, to: 1 + text.length, empty: text.length === 0 },
      doc: { textBetween: () => text },
    },
  };
  useEditorStore.getState().setTiptapEditor(editor as never);
  // The command reads the TAB-BOUND active editor (audit #887), so a test that
  // only fills the generic Tiptap slot is describing the very drift the fix is
  // about. Register both, bound to the tab under test.
  useEditorStore.getState().setActiveWysiwygEditor(editor as never, tabId);
}

beforeEach(() => {
  registerClaimCommands();
  useClaimStore.getState().reset();
  useWorkspaceStore.getState().openWorkspace("/ws");
});

describe("view.toggleClaims", () => {
  it("toggles the panel", async () => {
    expect(hasCommand("view.toggleClaims")).toBe(true);
    expect(useClaimStore.getState().panelOpen).toBe(false);
    await executeCommand("view.toggleClaims", undefined, { windowLabel: "main" });
    expect(useClaimStore.getState().panelOpen).toBe(true);
  });
});

describe("claims.extractFromSelection", () => {
  it("hands the selection + relative path to the panel as a draft", async () => {
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", "/ws/notes/elena.md");
    useTabStore.getState().setActiveTab("main", tabId);
    mockEditorWithSelection("Her eyes were green", tabId);
    await executeCommand("claims.extractFromSelection", undefined, {
      windowLabel: "main",
    });
    const s = useClaimStore.getState();
    expect(s.draftStatement).toBe("Her eyes were green");
    expect(s.draftSourcePath).toBe("notes/elena.md");
    expect(s.panelOpen).toBe(true);
  });

  it("does nothing for an empty selection", async () => {
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", "/ws/notes/elena.md");
    useTabStore.getState().setActiveTab("main", tabId);
    mockEditorWithSelection("   ", tabId);
    await executeCommand("claims.extractFromSelection", undefined, {
      windowLabel: "main",
    });
    expect(useClaimStore.getState().draftStatement).toBeNull();
  });

  // audit #887 — a claim carries the PROVENANCE of the text it quotes, so the
  // selection and the file path have to come from the same tab. `tiptap.editor`
  // is whichever editor registered last: with a split pane, or a Source pane
  // holding focus, it is not the editor showing the active document, and the
  // draft would quote one document under another document's path.
  it("refuses when the registered editor belongs to a different tab", async () => {
    const otherTab = useTabStore.getState().createTab("main");
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", "/ws/notes/elena.md");
    useTabStore.getState().setActiveTab("main", tabId);
    mockEditorWithSelection("Her eyes were green", otherTab);

    await executeCommand("claims.extractFromSelection", undefined, {
      windowLabel: "main",
    });

    expect(useClaimStore.getState().draftStatement).toBeNull();
  });

  it("refuses when no editor is registered as active at all", async () => {
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", "/ws/notes/elena.md");
    useTabStore.getState().setActiveTab("main", tabId);
    useEditorStore.getState().clearActiveEditors();

    await executeCommand("claims.extractFromSelection", undefined, {
      windowLabel: "main",
    });

    expect(useClaimStore.getState().draftStatement).toBeNull();
  });
});

// Audit #885 — the extraction has real prerequisites (a tab-bound editor with a
// selection, a saved document, an open workspace) and carried no `when`, so the
// palette offered a row that reported a successful dispatch and did nothing.
describe("claims.extractFromSelection availability", () => {
  function openDocumentTab(): string {
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", "/ws/notes/elena.md");
    useTabStore.getState().setActiveTab("main", tabId);
    return tabId;
  }

  it("is available, and dispatches, with a selection in a saved document", async () => {
    mockEditorWithSelection("Her eyes were green", openDocumentTab());

    await expect(
      executeCommand("claims.extractFromSelection", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(
      searchCommands("extract", { windowLabel: "main" }).map((r) => r.command.id),
    ).toContain("claims.extractFromSelection");
  });

  it("refuses the dispatch, and leaves the palette, with a COLLAPSED selection", async () => {
    mockEditorWithSelection("", openDocumentTab());

    await expect(
      executeCommand("claims.extractFromSelection", undefined, { windowLabel: "main" }),
    ).resolves.toBe(false);
    expect(
      searchCommands("extract", { windowLabel: "main" }).map((r) => r.command.id),
    ).not.toContain("claims.extractFromSelection");
  });

  it("refuses when the document has never been saved", async () => {
    const tabId = useTabStore.getState().createTab("main");
    useDocumentStore.getState().initDocument(tabId, "x", null);
    useTabStore.getState().setActiveTab("main", tabId);
    mockEditorWithSelection("Her eyes were green", tabId);

    await expect(
      executeCommand("claims.extractFromSelection", undefined, { windowLabel: "main" }),
    ).resolves.toBe(false);
  });

  it("refuses when no workspace is open", async () => {
    mockEditorWithSelection("Her eyes were green", openDocumentTab());
    useWorkspaceStore.getState().closeWorkspace();

    await expect(
      executeCommand("claims.extractFromSelection", undefined, { windowLabel: "main" }),
    ).resolves.toBe(false);
  });

  // The panel toggle has NO prerequisite and must keep none: it is how a user
  // opens the panel to look at claims already captured.
  it("leaves the panel toggle unconditionally available", async () => {
    useEditorStore.getState().clearActiveEditors();
    useWorkspaceStore.getState().closeWorkspace();

    await expect(
      executeCommand("view.toggleClaims", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
  });
});
