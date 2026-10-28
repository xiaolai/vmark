// @vitest-environment jsdom
// The journaled mutators (document.write, document.transform, selection.set,
// workflow.apply_patch) refuse a raw payload whose targeting, concurrency or
// persistence field is present with the wrong type — a tabId, an
// expected_revision, a save flag — naming the field, before any tab is
// resolved: it is never read as absent (a focused-tab write with no revision
// guard, saving on). Nothing is prepared and the buffer is unchanged. A
// malformed patches array keeps its own INVALID_PATCH refusal.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentTransform, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { handleWorkflowApplyPatch } from "@/services/mcpBridge/v2/workflow";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const TAB = "a";
const TEXT = "中文abc\n";
let view: CMView | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: null, title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, TEXT, null);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: TEXT, selection: { anchor: 0, head: 2 } }), parent });
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, TAB);
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  useUIStore.setState({ sourceMode: false });
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

function errorOf(requestId: string): { error: string; message: string } {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  expect(call[0].success).toBe(false);
  return JSON.parse(call[0].error ?? "null") as { error: string; message: string };
}

type Handler = (id: string, args: Record<string, unknown>) => Promise<void>;
const write: Handler = (id, args) => handleDocumentWrite(id, { content: "new\n", ...args }, TEST_WRITE_CONTEXT);
const transform: Handler = (id, args) => handleDocumentTransform(id, { kind: "cjk-spacing", ...args }, TEST_WRITE_CONTEXT);
const select: Handler = (id, args) => handleSelectionSet(id, { content: "X", ...args }, TEST_WRITE_CONTEXT);
const patch: Handler = (id, args) => handleWorkflowApplyPatch(id, { patches: [], ...args }, TEST_WRITE_CONTEXT);

describe.each([
  ["document.write", write, { tabId: 42, expected_revision: 42, save: "false", content: 7 }],
  ["document.transform", transform, { tabId: 42, expected_revision: 42, kind: 5 }],
  ["selection.set", select, { tabId: 42, expected_revision: 42, content: 7 }],
  ["workflow.apply_patch", patch, { tabId: 42, expected_revision: 42, patches: "x" }],
] as const)("%s", (_tool, handler, fields) => {
  it.each(Object.entries(fields))("refuses a malformed %s, naming it, and changes nothing", async (field, value) => {
    await handler("m1", { [field]: value });
    const error = errorOf("m1");
    expect(error.message).toContain(field);
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe(TEXT);
    expect(error.error).toBe(field === "patches" ? "INVALID_PATCH" : "INTERNAL");
  });
});

it("refuses every malformed field at once, naming each", async () => {
  await write("m1", { tabId: 42, save: "false" });
  expect(errorOf("m1").message).toMatch(/save.*tabId|tabId.*save/);
});
