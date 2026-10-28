// @vitest-environment jsdom
// The request-entry READ_ONLY gate runs before a journaled write's prepare is
// awaited; a document the user makes read-only while that prepare is held is
// refused READ_ONLY at the apply — for every journaled mutator (document.write,
// document.transform, selection.set, workflow.apply_patch) — with nothing
// changed and the journal transaction aborted. A document made read-only after
// the entry gate but before the write target is captured is refused READ_ONLY
// with nothing prepared.

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
const WORKFLOW = "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
let view: CMView | null = null;

function seed(text: string, filePath: string | null = null): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath, title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, text, filePath);
}

function source(text: string): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: 6, head: 11 } }), parent });
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, TAB);
}

function errorOf(requestId: string): Record<string, unknown> {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  expect(call[0].success).toBe(false);
  return JSON.parse(call[0].error ?? "null") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  useUIStore.setState({ sourceMode: false });
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

const MUTATORS: Array<[string, string, () => void, (id: string) => Promise<void>]> = [
  ["document.write", "old\n", () => seed("old\n"), (id) => handleDocumentWrite(id, { tabId: TAB, content: "new\n", save: false }, TEST_WRITE_CONTEXT)],
  ["document.transform", "中文abc\n", () => seed("中文abc\n"), (id) => handleDocumentTransform(id, { tabId: TAB, kind: "cjk-spacing" }, TEST_WRITE_CONTEXT)],
  ["selection.set", "hello world", () => (seed("hello world"), source("hello world")), (id) => handleSelectionSet(id, { content: "there" }, TEST_WRITE_CONTEXT)],
  [
    "workflow.apply_patch",
    WORKFLOW,
    () => seed(WORKFLOW, "/repo/.github/workflows/ci.yml"),
    (id) => handleWorkflowApplyPatch(id, { tabId: TAB, patches: [{ kind: "workflow.set", path: "name", value: "x" }] }, TEST_WRITE_CONTEXT),
  ],
];

describe.each(MUTATORS)("%s", (_tool, text, mount, run) => {
  it("made read-only while its prepare is held: refused READ_ONLY, nothing changed, the transaction aborted", async () => {
    mount();
    fake.holdNextPrepare();
    const running = run("w1");
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalled());
    useDocumentStore.getState().setReadOnly(TAB, true);
    fake.release();
    await running;

    expect(errorOf("w1")).toMatchObject({ error: "READ_ONLY" });
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe(text);
    expect(view?.state.doc.toString() ?? text).toBe(text);
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
    expect(fake.log.filter((e) => e.op === "abort")).toHaveLength(1);
  });
});

it("made read-only before the write target is captured: refused READ_ONLY with nothing prepared", async () => {
  seed("old\n");
  // The entry gate (handleRequest) passed; the lock lands before the handler's capture.
  useDocumentStore.getState().setReadOnly(TAB, true);
  await handleDocumentWrite("w2", { tabId: TAB, content: "new\n", save: false }, TEST_WRITE_CONTEXT);
  expect(errorOf("w2")).toMatchObject({ error: "READ_ONLY" });
  expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().documents[TAB]?.content).toBe("old\n");
});
