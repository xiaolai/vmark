// WI-AL2.1b — document.write, document.transform and workflow.apply_patch send their declared script with the prepare: the certificate of the preimage and the whole text each will produce, never on the commit. A live WYSIWYG write whose text serializes unchanged commits exactly the certificate's postimage (certified); one the editor re-serializes commits other text, so the journal's postimage check records it as a counted barrier.
//
// A real Tiptap editor and the real stores; the journal IPC client is the
// in-memory fake (src/test/agentJournalFake.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { handleDocumentTransform, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleWorkflowApplyPatch } from "@/services/mcpBridge/v2/workflow";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { textHash } from "@/services/agentJournal/provenance/payload";
import { declaredScriptCertificate } from "@/services/agentJournal/review/declaredScript";
import type { SelectionCertificate } from "@/services/agentJournal/selectionCertificate";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { markContentApplied } from "@/services/editor/contentApplied";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";

let editor: Editor | null = null;

function seed(id: string, text: string, filePath: string | null = null): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id, filePath, title: id, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: id },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(id, text, filePath);
}

/** A live editor whose initial load has run, flushing its serialization to the store as the mounted one does. */
function mountLive(tabId: string, html: string): void {
  const live = new Editor({ extensions: [StarterKit], content: html });
  editor = live;
  markContentApplied(live);
  useEditorStore.getState().setTiptapEditor(live);
  useEditorStore.getState().setActiveWysiwygEditor(live, tabId);
  registerWysiwygFlusher(tabId, () => {
    useDocumentStore.getState().setEditorContent(tabId, serializeMarkdown(live.schema, live.state.doc, getSerializeOptions()));
  });
}

const prepared = () => fake.prepareControlledWrite.mock.calls[0][0] as { preimage: string; certificate?: SelectionCertificate };
const committed = () => fake.commitControlledWrite.mock.calls[0] as unknown as [string, string, unknown];
const write = (content: string) => handleDocumentWrite("w1", { tabId: "t1", content, save: false }, TEST_WRITE_CONTEXT);

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  registerWysiwygFlusher("t1", null);
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor?.destroy();
  editor = null;
});

describe("declared script on the prepare", () => {
  it("document.write sends the script of the buffer and the written content", async () => {
    seed("t1", "old 文档 😀\n", "/notes/a.md");
    await write("new 文档 😁\n");
    expect(prepared().certificate).toEqual(await declaredScriptCertificate("old 文档 😀\n", "new 文档 😁\n"));
    expect(committed()[1]).toBe("new 文档 😁\n");
    expect(committed()[2]).toBeUndefined();
  });

  it("document.write of the buffer with a BOM and CRLF declares no change (WI-AL2.5)", async () => {
    seed("t1", "line one\nline two\n", "/notes/a.md");
    await write("﻿line one\r\nline two\r\n");
    expect(prepared().certificate).toEqual(await declaredScriptCertificate("line one\nline two\n", "line one\nline two\n"));
  });

  it("document.transform sends the script of the buffer and the transformed text", async () => {
    seed("t1", "测试ABC混合", "/notes/cjk.md");
    await handleDocumentTransform("x1", { tabId: "t1", kind: "cjk-spacing" }, TEST_WRITE_CONTEXT);
    expect(prepared().certificate).toEqual(await declaredScriptCertificate("测试ABC混合", "测试 ABC 混合"));
    expect(committed()[1]).toBe("测试 ABC 混合");
  });

  it("workflow.apply_patch sends the script of the buffer and the patched YAML", async () => {
    const yaml = "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    seed("wf", yaml, "/repo/.github/workflows/ci.yml");
    await handleWorkflowApplyPatch("z1", { tabId: "wf", patches: [{ kind: "workflow.set", path: "name", value: "renamed" }] }, TEST_WRITE_CONTEXT);
    expect(committed()[1]).toMatch(/^name: renamed/);
    expect(prepared().certificate).toEqual(await declaredScriptCertificate(yaml, committed()[1]));
  });
});

describe("declared script through a live WYSIWYG editor", () => {
  it("a write whose text serializes unchanged commits the certificate's postimage", async () => {
    seed("t1", "old document\n", "/notes/a.md");
    mountLive("t1", "<p>old document</p>");
    await write("AI text\n");
    expect(editor?.getText()).toBe("AI text");
    expect(committed()[1]).toBe("AI text\n");
    expect(prepared().certificate?.postHash).toBe(await textHash(committed()[1]));
  });

  it("a write the editor re-serializes commits other text, so the journal falls back to a barrier", async () => {
    seed("t1", "old document\n", "/notes/a.md");
    mountLive("t1", "<p>old document</p>");
    // `*` bullets and `_` emphasis come back in the serializer's own markers.
    const written = "* one\n* two\n\n_em_\n";
    await write(written);
    expect(committed()[1]).not.toBe(written);
    expect(prepared().certificate?.postHash).toBe(await textHash(written));
    expect(prepared().certificate?.postHash).not.toBe(await textHash(committed()[1]));
  });
});
