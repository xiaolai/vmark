// WI-2b.6 — claim commands: panel toggle + extract-from-selection with
// provenance (the only claim-creation entry point, D2.2).
import { beforeEach, describe, expect, it } from "vitest";

import { registerClaimCommands } from "./claimCommands";
import { executeCommand, hasCommand } from "./CommandBus";
import { useClaimStore } from "@/stores/claimStore";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

function mockEditorWithSelection(text: string) {
  const editor = {
    state: {
      selection: { from: 1, to: 1 + text.length },
      doc: { textBetween: () => text },
    },
  };
  useEditorStore.getState().setTiptapEditor(editor as never);
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
    mockEditorWithSelection("Her eyes were green");
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
    mockEditorWithSelection("   ");
    await executeCommand("claims.extractFromSelection", undefined, {
      windowLabel: "main",
    });
    expect(useClaimStore.getState().draftStatement).toBeNull();
  });
});
