// WI-AL2.0 — The WYSIWYG collector decides whether a flush reports by ledger progress, never by Markdown equality: a delete-and-retype (ASCII, CJK, emoji), a mark toggled and untoggled, and the agent-then-human regression all leave the text equal yet report one deferral with a bounded break over the touched block only (the span oracle blocks the retyped hunk and maps a disjoint one exactly), arming the epoch; an unobserved or capped chain at equal text reports a whole break; a selection-only or transaction-free flush reports nothing; on an empty, whitespace-only or single-empty-paragraph document an insert-then-delete is touched in WYSIWYG exactly as in Source (a zero-width break at the touched empty block); a block inserted and deleted between two others, which touches no block, is a whole break.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));

import type { Editor } from "@tiptap/core";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSourceProvenance } from "@/services/agentJournal/collectors/sourceCollector";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { ProvenanceSession, type ProvenanceCollector } from "@/services/agentJournal/provenance/session";
import { provenanceSessionFor, startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { TxnLedger } from "../txnLedger";
import { deleteAndRetype, destroyEditors, flush, freezeDecoded, load, mapHunk, mount, passStepBudget, posOf, store } from "@/test/wysiwygNetZeroHarness";

const TEXT = "# Title\n\npara one\n\npara two 中文😀\n";
let stop: (() => void) | null = null;
let defers = 0;
let chainSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store().initDocument("t1", "", null);
  stop = startProvenanceSessions();
  provenanceSessionFor("t1")!.fork(TEXT).recorded("r0");
  store().setEditorContent("t1", TEXT);
  defers = 0;
  const attach = ProvenanceSession.prototype.attach;
  vi.spyOn(ProvenanceSession.prototype, "attach").mockImplementation(function (this: ProvenanceSession, ...args): ProvenanceCollector {
    const collector = attach.apply(this, args);
    const defer = collector.defer;
    return { ...collector, defer: (after, materialize) => (defers++, defer(after, materialize)) };
  });
  chainSpy = vi.spyOn(TxnLedger.prototype, "chain");
});
afterEach(() => {
  destroyEditors();
  stop?.();
  stop = null;
  vi.restoreAllMocks();
});

function loaded(text = TEXT): Editor {
  const editor = mount();
  load(editor, text);
  chainSpy.mockClear();
  defers = 0;
  return editor;
}

describe("wysiwyg collector — net-zero flushes", () => {
  it.each([
    ["a single character", "o", "para one", "ara tw"],
    ["a CJK character", "中", "para two 中文😀", "ara on"],
    ["an emoji (a surrogate pair)", "😀", "para two 中文😀", "itl"],
    // A disjoint hunk stays clear of the separators beside the touched block: those are part of its break (R20).
  ])("deleting and retyping %s reads the ledger once, defers once, and breaks only the touched block", async (_n, ch, touched, disjoint) => {
    const editor = loaded();
    deleteAndRetype(editor, ch);
    expect(flush(editor)).toBe(TEXT);
    expect(chainSpy).toHaveBeenCalledTimes(1);
    expect(defers).toBe(1);
    const { touched: wasTouched, p } = await freezeDecoded("t1", TEXT);
    expect(wasTouched).toBe(true);
    expect(p.whole).toBeNull();
    expect(p.bounded.map((b) => b.origin)).toEqual(["wysiwyg:pm-touched"]);
    expect(mapHunk(p, TEXT, touched).block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });
    const from = TEXT.indexOf(disjoint);
    expect(mapHunk(p, TEXT, disjoint)).toEqual({ span: { from, to: from + disjoint.length, growing: false }, hit: false, edited: false, block: null });
  });

  it("a mark toggled and untoggled (serialization-neutral) is a bounded break, not an identity", async () => {
    const editor = loaded();
    const at = posOf(editor, "one");
    editor.chain().setTextSelection({ from: at, to: at + 3 }).toggleBold().run();
    editor.chain().setTextSelection({ from: at, to: at + 3 }).toggleBold().run();
    expect(flush(editor)).toBe(TEXT);
    expect(defers).toBe(1);
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(true);
    expect(mapHunk(p, TEXT, "para one").block).not.toBeNull();
    expect(mapHunk(p, TEXT, "itl").block).toBeNull();
  });

  it("the agent-then-human regression: a retyped agent hunk is blocked, not mapped as an identity", async () => {
    const before = "# Title\n\nx\n\npara two\n";
    const after = "# Title\n\na\n\npara two\n";
    provenanceSessionFor("t1")!.fork(before).recorded("r1");
    store().setEditorContent("t1", before);
    const editor = loaded(before);
    // The agent's write x → a, applied as a controlled write and loaded into the live editor.
    provenanceSessionFor("t1")!.fork(after).recorded("r2");
    store().setEditorContent("t1", after);
    load(editor, after);
    deleteAndRetype(editor, "a");
    expect(flush(editor)).toBe(after);
    const { touched, p } = await freezeDecoded("t1", after);
    expect(touched).toBe(true);
    const h = mapHunk(p, after, "\na\n");
    // Before the fix the window was an identity: { span: itself, block: null }, so a revert of H overwrote the person's "a".
    expect(h.block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });
    expect(mapHunk(p, after, "ara tw").block).toBeNull();
  });

  it("a net-zero report arms the editing epoch", async () => {
    const editor = loaded();
    deleteAndRetype(editor, "o");
    flush(editor);
    await provenanceSessionFor("t1")!.idle();
    expect(agentJournalEpochFake.armEpoch).toHaveBeenCalled();
  });

  it("a selection-only flush reads the ledger and reports nothing", async () => {
    const editor = loaded();
    editor.commands.setTextSelection(posOf(editor, "two"));
    expect(flush(editor)).toBe(TEXT);
    expect(chainSpy).toHaveBeenCalledTimes(1);
    expect(defers).toBe(0);
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(false);
    expect(p.whole).toBeNull();
    expect(p.bounded).toEqual([]);
  });

  it("an equal-text flush with no transaction reports nothing: no false barrier", async () => {
    const editor = loaded();
    expect(flush(editor)).toBe(TEXT);
    expect(defers).toBe(0);
    await provenanceSessionFor("t1")!.idle();
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalled();
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(false);
    expect(p.bounded).toEqual([]);
  });

  it("an unobserved chain at equal text (another surface held the text) reports a whole break", async () => {
    const editor = loaded();
    const s = provenanceSessionFor("t1")!;
    const other = {};
    const source = s.attach(other, s.openView(other), "source");
    source.edit(TEXT, [{ fromA: 0, toA: 1, fromB: 0, toB: 0 }], TEXT.slice(1));
    source.edit(TEXT.slice(1), [{ fromA: 0, toA: 0, fromB: 0, toB: 1 }], TEXT);
    await freezeDecoded("t1", TEXT);
    deleteAndRetype(editor, "o");
    expect(flush(editor)).toBe(TEXT);
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(true);
    expect(p.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:no-certificate" });
  });

  it("a capped chain at equal text reports a whole capOverflow break", async () => {
    const editor = loaded();
    // Net zero after every transaction, past the ledger's step budget in sum.
    passStepBudget(editor, posOf(editor, "one"));
    expect(flush(editor)).toBe(TEXT);
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(true);
    expect(p.whole).toEqual({ reason: "capOverflow", origin: "wysiwyg:chain-cap" });
  });

  it("a block inserted and deleted between two others touches no block: a whole break, not an identity", async () => {
    const editor = loaded();
    let at = -1;
    editor.state.doc.forEach((node, offset) => {
      if (at < 0 && node.textContent === "para one") at = offset + node.nodeSize;
    });
    editor.view.dispatch(editor.state.tr.insert(at, editor.schema.nodes.paragraph.create(null, editor.schema.text("tmp"))));
    editor.view.dispatch(editor.state.tr.delete(at, at + 5));
    expect(flush(editor)).toBe(TEXT);
    expect(defers).toBe(1);
    const { touched, p } = await freezeDecoded("t1", TEXT);
    expect(touched).toBe(true);
    expect(p.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unlocated-steps" });
  });

  describe("an insert-then-delete on a document with no visible text is touched in both modes", () => {
    /** The same net-zero edit in Source over `text`: insert "z" at 0, delete it. */
    async function sourceTouched(text: string): Promise<boolean> {
      provenanceSessionFor("t1")!.fork(text).recorded("rS");
      store().setEditorContent("t1", text);
      const provenance = createSourceProvenance("t1", () => true);
      const writer = EditorView.updateListener.of((u) => u.docChanged && store().setEditorContent("t1", u.state.doc.toString()));
      const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [provenance.extension, writer] }), parent: document.body });
      provenance.start(view);
      view.dispatch({ changes: { from: 0, insert: "z" } });
      view.dispatch({ changes: { from: 0, to: 1 } });
      const { touched } = await freezeDecoded("t1", text);
      view.destroy();
      return touched;
    }

    it.each([
      ["an empty document", ""],
      ["a whitespace-only document", "   \n"],
      ["a single empty paragraph", "\n"],
    ])("%s", async (_n, raw) => {
      const editor = mount();
      load(editor, raw);
      // The session holds what the editor serializes, as it does after a real load and flush.
      const text = flush(editor);
      provenanceSessionFor("t1")!.fork(text).recorded("rE");
      store().setEditorContent("t1", text);
      load(editor, text);
      defers = 0;
      editor.view.dispatch(editor.state.tr.insertText("z", 1));
      editor.view.dispatch(editor.state.tr.delete(1, 2));
      expect(flush(editor)).toBe(text);
      expect(defers).toBe(1);
      const { touched, p } = await freezeDecoded("t1", text);
      expect({ touched, whole: p.whole }).toEqual({ touched: true, whole: null });
      expect(p.bounded.length).toBeGreaterThan(0);
      expect(p.bounded.every((b) => b.reason === "uncertifiedRange" && b.origin.startsWith("wysiwyg:"))).toBe(true);
      expect(await sourceTouched(text)).toBe(true);
    });
  });
});
