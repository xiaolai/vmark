/**
 * WI-AL1.4 — agent edit journal collectors under IME composition in REAL WebKit: a
 * scripted composition (compositionstart, the marked text mutated in the
 * real DOM with an input event per update, compositionend) through the
 * production Source collector (CodeMirror) and the production WYSIWYG
 * collector (the Tiptap extension stack with its observer), each wired as
 * the app wires it. A committed composition is certified end to end (no
 * whole-document break), the session's text is what the store holds, and a
 * cancelled one changes nothing.
 *
 * Synthetic composition is the ceiling for WebKit under automation; see
 * `src/test/editorComposition.webkit.test.ts` for the reasoning and the
 * manual real-IME checklist.
 *
 * @module services/agentJournal/collectors/__tests__/provenanceIme.webkit.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/services/agentJournal/epochClient", async (importOriginal) => {
  let n = 0;
  return {
    ...(await importOriginal<object>()),
    armEpoch: async (docKey: string) => ({ doc: docKey, epoch: String(++n), head: null, headHash: null }),
    closeEpoch: async () => {},
  };
});

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { setContentWithoutHistory } from "@/components/Editor/tiptapContentLoad";
import { useDocumentStore } from "@/stores/documentStore";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { freezeUnsavedProvenance } from "../../unsavedProvenance";
import { provenanceSessionFor, startProvenanceSessions } from "../../provenanceSessions";
import { createSourceProvenance } from "../sourceCollector";
import { noteWysiwygFlush } from "../wysiwyg/wysiwygCollector";

type Breaks = { whole: { reason: string; origin: string } | null; bounded: { origin: string }[] };
async function breaksOf(buffer: string): Promise<Breaks> {
  const f = freezeUnsavedProvenance("t1", buffer)!;
  const named = await f.payload(null);
  expect(named, "a payload for the window").not.toBeNull();
  f.recorded(named!.basis);
  return (named!.payload as unknown as { body: { breaks: Breaks } }).body.breaks;
}

const store = () => useDocumentStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 20));
const OPTS = { preserveBlankLines: true } as const;
let stop: (() => void) | null = null;
const cleanup: (() => void)[] = [];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  store().initDocument("t1", "", null);
  stop = startProvenanceSessions();
});
afterEach(() => {
  for (const c of cleanup.splice(0)) c();
  stop?.();
  stop = null;
});

interface Composition {
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * A scripted composition in the existing text node `node` at `offset`: the
 * marked text is written into that node in place, as a WebKit input method
 * does, with the caret after it.
 */
async function compose(target: HTMLElement, node: Text, offset: number): Promise<Composition> {
  const before = node.data.slice(0, offset);
  const after = node.data.slice(offset);
  target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  await tick();
  const setMarked = async (text: string) => {
    node.data = before + text + after;
    window.getSelection()!.collapse(node, before.length + text.length);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: text }));
    await tick();
  };
  return {
    async update(text) {
      target.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: text }));
      await setMarked(text);
    },
    async commit(text) {
      await setMarked(text);
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
      await tick();
    },
    async cancel() {
      await setMarked("");
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
      await tick();
    },
  };
}

/** The text node at `pos` (a DOM position whose node is text, or the text child at its offset). */
function textAt(at: { node: Node; offset: number }): { node: Text; offset: number } {
  if (at.node instanceof Text) return { node: at.node, offset: at.offset };
  const before = at.node.childNodes[at.offset - 1];
  if (before instanceof Text) return { node: before, offset: before.length };
  const child = at.node.childNodes[at.offset];
  if (child instanceof Text) return { node: child, offset: 0 };
  throw new Error("no text node at the position");
}

describe("Source collector under composition (real WebKit)", () => {
  function mountSource() {
    const provenance = createSourceProvenance("t1", () => true);
    const writer = EditorView.updateListener.of((u) => {
      if (u.docChanged) store().setEditorContent("t1", u.state.doc.toString());
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc: store().documents.t1.content, extensions: [provenance.extension, writer] }), parent });
    provenance.start(view);
    cleanup.push(() => {
      provenance.stop();
      view.destroy();
      parent.remove();
    });
    view.focus();
    return view;
  }

  it("a committed multi-step composition is certified, and the store holds the committed text", async () => {
    const view = mountSource();
    view.dispatch({ changes: { from: 0, insert: "ab" }, selection: { anchor: 1 } });
    await tick();
    const at = textAt(view.domAtPos(1));
    const session = await compose(view.contentDOM, at.node, at.offset);
    for (const step of ["ｓ", "す", "すｓ", "すし"]) await session.update(step);
    await session.commit("すし");
    expect(view.state.doc.toString()).toBe("aすしb");
    expect(store().documents.t1.content).toBe("aすしb");
    expect(provenanceSessionFor("t1")!.text).toBe("aすしb");
    expect((await breaksOf("aすしb")).whole).toBeNull();
  });

  it("a cancelled composition changes nothing", async () => {
    const view = mountSource();
    view.dispatch({ changes: { from: 0, insert: "ab" }, selection: { anchor: 2 } });
    await tick();
    const at = textAt(view.domAtPos(2));
    const session = await compose(view.contentDOM, at.node, at.offset);
    await session.update("す");
    await session.cancel();
    expect(view.state.doc.toString()).toBe("ab");
    expect(store().documents.t1.content).toBe("ab");
    expect((await breaksOf("ab")).whole).toBeNull();
  });
});

describe("WYSIWYG collector under composition (real WebKit)", () => {
  function mountWysiwyg() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({ element, extensions: createTiptapExtensions({ tabId: "t1" }) });
    cleanup.push(() => {
      editor.destroy();
      element.remove();
    });
    return editor;
  }
  const flush = (editor: Editor) => {
    const markdown = serializeMarkdown(editor.schema, editor.state.doc, OPTS);
    noteWysiwygFlush(editor, markdown, OPTS);
    store().setEditorContent("t1", markdown);
    return markdown;
  };

  it("a committed composition flushes as a bounded break of its block, nothing whole", async () => {
    const text = "# Title\n\npara\n";
    provenanceSessionFor("t1")!.fork(text).recorded("r0");
    store().setEditorContent("t1", text);
    const editor = mountWysiwyg();
    setContentWithoutHistory(editor, parseMarkdown(editor.schema, text, OPTS), () => true, text);
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "para") end = pos + 4;
    });
    editor.commands.setTextSelection(end);
    editor.view.focus();
    await tick();
    const at = textAt(editor.view.domAtPos(end));
    const session = await compose(at.node.parentElement!, at.node, at.offset);
    await session.update("nihao");
    await session.commit("你好");
    expect(editor.state.doc.textContent).toContain("para你好");
    const md = flush(editor);
    expect(md).toBe("# Title\n\npara你好\n");
    const breaks = await breaksOf(md);
    expect(breaks.whole).toBeNull();
    expect(breaks.bounded.map((b) => b.origin)).toEqual(["wysiwyg:pm-touched"]);
  });
});
