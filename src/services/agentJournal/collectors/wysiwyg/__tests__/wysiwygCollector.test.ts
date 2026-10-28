// WI-AL1.4 — The WYSIWYG provenance collector on the production Tiptap stack: a load of the session's text certifies the editor, typing flushes as bounded block breaks (CJK and emoji included), consecutive flushes form one window, and every gap fails closed as a whole-document break — no load, a load of other text, another surface holding the text (even at equal text), an unknown step, a plugin set changed while live (loud and snapshot-only), a state installed behind the ledger, a replaced session — with the next flush re-anchoring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));

import { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { useDocumentStore } from "@/stores/documentStore";
import { journalWarn } from "@/utils/debug";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { freezeUnsavedProvenance } from "../../../unsavedProvenance";
import { provenanceSessionFor, startProvenanceSessions } from "../../../provenanceSessions";
import { setContentWithoutHistory } from "@/components/Editor/tiptapContentLoad";
import { noteWysiwygFlush, wysiwygProvenanceExtension } from "../wysiwygCollector";

class OpaqueStep extends Step {
  override apply(doc: PMNode) { return StepResult.ok(doc.type.create(doc.attrs, doc.content)); }
  override invert() { return this; }
  override map() { return this; }
  override getMap() { return StepMap.empty; }
  override toJSON() { return { stepType: "opaqueForTest" }; }
}

type Breaks = { whole: { reason: string; origin: string } | null; bounded: { origin: string }[] };
async function breaksOf(tabId: string, buffer: string): Promise<Breaks> {
  const f = freezeUnsavedProvenance(tabId, buffer)!;
  const named = await f.payload(null);
  expect(named).not.toBeNull();
  f.recorded(named!.basis);
  return (named!.payload as unknown as { body: { breaks: Breaks } }).body.breaks;
}

const store = () => useDocumentStore.getState();
const OPTS = { preserveBlankLines: true } as const;
const TEXT = "# Title\n\npara one\n\npara two\n";
let stop: (() => void) | null = null;
const editors: Editor[] = [];

function mount(tabId = "t1") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [...createTiptapExtensions(), wysiwygProvenanceExtension(tabId)] });
  editors.push(editor);
  return editor;
}
/** A content load through the production load path (it notes the collector). */
function load(editor: Editor, markdown: string) {
  expect(setContentWithoutHistory(editor, parseMarkdown(editor.schema, markdown, OPTS), () => true, markdown)).toBe("applied");
}
/** A flush the way useTiptapFlush does it: note, then the store write. */
function flush(editor: Editor, tabId = "t1") {
  const markdown = serializeMarkdown(editor.schema, editor.state.doc, OPTS);
  noteWysiwygFlush(editor, markdown, OPTS);
  store().setEditorContent(tabId, markdown);
  return markdown;
}
function typeAfter(editor: Editor, needle: string, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle) + needle.length;
  });
  editor.view.dispatch(editor.state.tr.insertText(text, at));
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  store().initDocument("t1", "", null);
  stop = startProvenanceSessions();
  // A window with a known basis on TEXT: a controlled write recorded as revision "r0".
  provenanceSessionFor("t1")!.fork(TEXT).recorded("r0");
  store().setEditorContent("t1", TEXT);
  vi.mocked(journalWarn).mockClear();
});
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  stop?.();
  stop = null;
});

describe("wysiwyg collector", () => {
  it("certifies typing as a bounded break of the touched block only", async () => {
    const editor = mount();
    load(editor, TEXT);
    typeAfter(editor, "para one", " 中文😀");
    const md = flush(editor);
    expect(md).toBe("# Title\n\npara one 中文😀\n\npara two\n");
    const breaks = await breaksOf("t1", md);
    expect(breaks.whole).toBeNull();
    expect(breaks.bounded.map((b) => b.origin)).toEqual(["wysiwyg:pm-touched"]);
  });

  it("consecutive flushes are one window; the next window chains from the last head", async () => {
    const editor = mount();
    load(editor, TEXT);
    typeAfter(editor, "Title", "A");
    flush(editor);
    typeAfter(editor, "para two", "B");
    const md = flush(editor);
    const first = await breaksOf("t1", md);
    expect(first.whole).toBeNull();
    // Two blocks with a certified one between them: two breaks, not one.
    expect(first.bounded).toHaveLength(2);
    typeAfter(editor, "para one", "C");
    const md2 = flush(editor);
    const second = await breaksOf("t1", md2);
    expect(second.whole).toBeNull();
    expect(second.bounded).toHaveLength(1);
  });

  it("a flush with no load is uncertified; the next window certifies", async () => {
    const editor = mount();
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, parseMarkdown(editor.schema, TEXT, OPTS).content));
    typeAfter(editor, "para one", "A");
    const md = flush(editor);
    expect((await breaksOf("t1", md)).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:attach" });
    typeAfter(editor, "para two", "B");
    expect((await breaksOf("t1", flush(editor))).whole).toBeNull();
  });

  it("a load of text the session does not hold attaches uncertified", async () => {
    const editor = mount();
    load(editor, "other\n");
    expect((await breaksOf("t1", TEXT)).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:attach" });
  });

  it("another surface changing the text, even back to equal, voids the anchor", async () => {
    const editor = mount();
    load(editor, TEXT);
    const s = provenanceSessionFor("t1")!;
    const other = {};
    const source = s.attach(other, s.openView(other), "source");
    source.edit(TEXT, [{ fromA: 0, toA: 1, fromB: 0, toB: 0 }], TEXT.slice(1));
    source.edit(TEXT.slice(1), [{ fromA: 0, toA: 0, fromB: 0, toB: 1 }], TEXT);
    expect((await breaksOf("t1", TEXT)).whole).toBeNull();
    typeAfter(editor, "para one", "A");
    expect((await breaksOf("t1", flush(editor))).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:no-certificate" });
  });

  it("a flush that changes nothing reports nothing", async () => {
    const editor = mount();
    load(editor, TEXT);
    flush(editor);
    const s = provenanceSessionFor("t1")!;
    expect(s.freeze(TEXT).touched).toBe(false);
  });

  it("an unknown step breaks the whole document", async () => {
    const editor = mount();
    load(editor, TEXT);
    editor.view.dispatch(editor.state.tr.step(new OpaqueStep()));
    typeAfter(editor, "para one", "A");
    expect((await breaksOf("t1", flush(editor))).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unknown-step" });
  });

  it.each([
    ["registered", (e: Editor) => e.registerPlugin(new Plugin({ key: new PluginKey("lateForTest") }))],
    ["unregistered", (e: Editor) => e.unregisterPlugin("markdownLint")],
  ])("a plugin %s while live is a loud whole-document break at once, and the editor recovers", async (_name, change) => {
    const editor = mount();
    load(editor, TEXT);
    editor.registerPlugin(new Plugin({ key: new PluginKey("markdownLint") }));
    // re-anchor after the setup change above
    load(editor, TEXT);
    await breaksOf("t1", TEXT);
    vi.mocked(journalWarn).mockClear();
    change(editor);
    expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("observation interrupted (attach)"));
    expect((await breaksOf("t1", TEXT)).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unobserved-transaction" });
    typeAfter(editor, "para one", "A");
    expect((await breaksOf("t1", flush(editor))).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:no-certificate" });
    typeAfter(editor, "para two", "B");
    expect((await breaksOf("t1", flush(editor))).whole).toBeNull();
  });

  it("a state installed behind the ledger's back is a whole-document break", async () => {
    const editor = mount();
    load(editor, TEXT);
    const held = editor.state;
    typeAfter(editor, "para one", "A");
    editor.view.updateState(held);
    expect((await breaksOf("t1", TEXT)).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unobserved-transaction" });
  });

  it("a replaced session (save-as) is re-attached uncertified", async () => {
    const editor = mount();
    load(editor, TEXT);
    store().setFilePath("t1", "/new.md");
    typeAfter(editor, "para one", "A");
    const md = flush(editor);
    const s = provenanceSessionFor("t1")!;
    expect(s.text).toBe(md);
    const f = s.freeze(md);
    expect(f.touched).toBe(true);
    f.invalidate();
  });

  it("teardown detaches: a new editor certifies on its own load", async () => {
    const first = mount();
    load(first, TEXT);
    first.destroy();
    expect(journalWarn).not.toHaveBeenCalled();
    const second = mount();
    load(second, TEXT);
    typeAfter(second, "para two", "!");
    expect((await breaksOf("t1", flush(second))).whole).toBeNull();
  });

  it("an editor of no session's tab is inert", () => {
    const editor = mount("nope");
    load(editor, TEXT);
    typeAfter(editor, "para one", "A");
    expect(() => noteWysiwygFlush(editor, "x", OPTS)).not.toThrow();
  });
});
