// WI-AL2.0 — The WYSIWYG net-zero regression end to end, through the real provenance session, the journaled-mutation coordinator and the journal fake: agent `x → a`, the person deletes and retypes `a`, a distant agent write through the production write path (its target capture and re-checks flush the editor; the test never does), a certified disjoint human edit. The distant write's prepare is touched and records a baseline whose map blocks the retyped hunk; the later save maps the disjoint agent hunk exactly; with a save and an editor/session restart after the retype, the save carries the break instead; a net-zero edit arms the epoch (a crash leaves it open); the same delete-and-retype in Source mode is touched too. | AL2.2g: the agent write's prepare is the request spec the coordinator sends; its prepared transaction is read at the re-verify.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));

import type { Editor } from "@tiptap/core";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { TEST_ATTRIBUTION, TEST_WRITE_CONTEXT, testAdmittedReads } from "@/test/mcpAttributionFixture";
import { useRevisionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { runJournaledEdit } from "@/services/mcpBridge/v2/journaledEdit";
import { journalActorFor } from "../journalActor";
import { controlledPrepare, type PreparedTxn } from "../journalClient";
import { journalBasis, journalTabLife, rememberJournalBasis } from "../documentIdentity";
import { runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { provenanceSessionFor, startProvenanceSessions } from "../provenanceSessions";
import { beginJournalSave } from "../saveJournal";
import { decodePayload } from "../provenance/payload";
import { createSourceProvenance } from "../collectors/sourceCollector";
import {
  deleteAndRetype,
  destroyEditors,
  flush,
  freezeDecoded,
  load,
  mapHunk,
  mount,
  store,
  typeAfter,
} from "@/test/wysiwygNetZeroHarness";

const PATH = "/notes.md";
const KEY = `path:${PATH}`;
const T0 = "# Notes\n\nx\n\npara two\n\nfar end\n";
const T1 = "# Notes\n\na\n\npara two\n\nfar end\n";
const T2 = "# Notes\n\na\n\npara two\n\nfar END\n";
const T3 = "# Notes\n\na\n\npara two!\n\nfar END\n";
const actor = journalActorFor(TEST_ATTRIBUTION);
let stop: (() => void) | null = null;

const prepareInput = (n: number) => fake.prepareControlledWrite.mock.calls[n][0];
const lastCapture = () => fake.captureSaveToJournal.mock.calls.at(-1)![0];

/** An agent write of `post` through the production coordinator, then the live editor's reload. */
async function agentWrite(editor: Editor, post: string): Promise<PreparedTxn> {
  flush(editor);
  const preimage = store().documents.t1.content;
  let prepared: PreparedTxn | null = null;
  const out = await runJournaledMutation<string, PreparedTxn, JournaledOutcome<string>>({
    tabId: "t1",
    life: journalTabLife("t1"),
    docKey: KEY,
    preimage,
    retryHint: "retry",
    prepare: (baseline) => controlledPrepare({ ...baseline, actor, tool: "document.write" }),
    verify: (p) => {
      prepared = p;
      return null;
    },
    apply: () => {
      store().setEditorContent("t1", post);
      return { postimage: post, value: "ok" };
    },
    recover: () => store().documents.t1.content,
    outcome: (o) => o,
  });
  expect(out.status).toBe("applied");
  load(editor, post);
  return prepared!;
}

/**
 * A `document.write` of `post` through the production write path
 * (`runJournaledEdit`: target capture, re-check, coordinator), with the
 * editor's flusher registered as `useTiptapFlush` registers it. Nothing here
 * flushes by hand: the write path's own flushes report the editor.
 */
async function documentWrite(editor: Editor, post: string): Promise<PreparedTxn> {
  const tab: DocumentTab = { kind: "document", id: "t1", filePath: PATH, title: "notes", isPinned: false, formatId: "markdown" };
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: "t1" }, untitledCounter: 0 });
  registerWysiwygFlusher("t1", () => flush(editor));
  try {
    const calls = fake.prepareControlledWrite.mock.calls.length;
    const out = await runJournaledEdit("w1", {
      tab: { tabId: "t1", revision: useRevisionStore.getState().getRevision("t1"), filePath: PATH },
      preimage: store().documents.t1.content,
      requireFocus: false,
      tool: "document.write",
      context: TEST_WRITE_CONTEXT,
      reads: testAdmittedReads(),
      apply: () => {
        store().setEditorContent("t1", post);
        return { postimage: post, value: "ok" };
      },
    });
    expect(out).toMatchObject({ value: "ok" });
    expect(fake.prepareControlledWrite.mock.calls.length).toBe(calls + 1);
  } finally {
    registerWysiwygFlusher("t1", null);
  }
  load(editor, post);
  return (await fake.prepareControlledWrite.mock.results.at(-1)!.value) as PreparedTxn;
}

async function save(text: string) {
  return beginJournalSave("t1", PATH, text, { saveType: "manual" }).record();
}

function boot(): Editor {
  stop = startProvenanceSessions();
  const editor = mount();
  load(editor, store().documents.t1.content);
  return editor;
}

function restart(): Editor {
  stop?.();
  destroyEditors();
  return boot();
}

beforeEach(() => {
  Object.assign(fake.doc(KEY), { head: "rev-0", text: T0 });
  store().initDocument("t1", T0, PATH);
  rememberJournalBasis("t1", KEY, "rev-0");
});
afterEach(() => {
  destroyEditors();
  stop?.();
  stop = null;
});

describe("net-zero WYSIWYG edits through the journal", () => {
  it("the full sequence: the baseline exists and blocks the retyped hunk; a disjoint hunk maps exactly", async () => {
    const editor = boot();
    await agentWrite(editor, T1); // H: x → a
    deleteAndRetype(editor, "a");
    const distant = await documentWrite(editor, T2); // the load right after the net-zero edit, no hand flush
    expect(prepareInput(1)).toMatchObject({ preimage: T1, baselineTouched: true });
    expect(distant.baseline).not.toBeNull();
    const baselineMap = decodePayload(prepareInput(1).baselineProvenance);
    // The inverted span is gone: before the fix H mapped onto itself, unblocked, and its revert overwrote the person's "a".
    expect(mapHunk(baselineMap, T1, "\na\n").block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });
    expect(mapHunk(baselineMap, T1, "far end").block).toBeNull();
    typeAfter(editor, "para two", "!");
    expect(flush(editor)).toBe(T3);
    await save(T3);
    const saveMap = decodePayload(lastCapture().provenance);
    // Clear of the separators beside the edited block, which are part of its break.
    const from = T3.indexOf("ar EN");
    expect(mapHunk(saveMap, T2, "ar EN")).toEqual({ span: { from, to: from + 5, growing: false }, hit: false, edited: false, block: null });
  });

  it("with a save and a restart after the retype, the save carries the break", async () => {
    let editor = boot();
    await agentWrite(editor, T1);
    deleteAndRetype(editor, "a");
    flush(editor);
    await save(T1);
    const saved = decodePayload(lastCapture().provenance);
    expect(mapHunk(saved, T1, "\na\n").block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });
    expect(mapHunk(saved, T1, "ara tw").block).toBeNull();
    editor = restart();
    expect(journalBasis("t1", KEY)).toBe(fake.doc(KEY).head);
    await agentWrite(editor, T2);
    expect(prepareInput(1)).toMatchObject({ baselineTouched: false });
    typeAfter(editor, "para two", "!");
    flush(editor);
    await save(T3);
    const from = T3.indexOf("ar EN");
    expect(mapHunk(decodePayload(lastCapture().provenance), T2, "ar EN")).toMatchObject({ span: { from, to: from + 5 }, block: null });
  });

  it("a net-zero edit arms the epoch, so a crash before the save leaves it open", async () => {
    const editor = boot();
    await agentWrite(editor, T1);
    await provenanceSessionFor("t1")!.idle();
    expect(agentJournalEpochFake.openEpoch(KEY)).toBeNull();
    deleteAndRetype(editor, "a");
    flush(editor);
    await provenanceSessionFor("t1")!.idle();
    expect(agentJournalEpochFake.openEpoch(KEY)).not.toBeNull();
  });

  it("Source-mode control: the same delete-and-retype is touched and edits the hunk", async () => {
    stop = startProvenanceSessions();
    provenanceSessionFor("t1")!.fork(T1).recorded("rev-1");
    store().setEditorContent("t1", T1);
    const provenance = createSourceProvenance("t1", () => true);
    const writer = EditorView.updateListener.of((u) => u.docChanged && store().setEditorContent("t1", u.state.doc.toString()));
    const view = new EditorView({ state: EditorState.create({ doc: T1, extensions: [provenance.extension, writer] }), parent: document.body });
    provenance.start(view);
    const at = T1.indexOf("\na\n") + 1;
    view.dispatch({ changes: { from: at, to: at + 1 } });
    view.dispatch({ changes: { from: at, insert: "a" } });
    const { touched, p } = await freezeDecoded("t1", T1);
    view.destroy();
    expect(touched).toBe(true);
    expect(mapHunk(p, T1, "\na\n")).toMatchObject({ edited: true });
    expect(mapHunk(p, T1, "far end")).toMatchObject({ edited: false, block: null });
  });
});
