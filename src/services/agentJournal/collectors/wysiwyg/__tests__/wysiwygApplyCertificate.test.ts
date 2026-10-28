// WI-AL2.1c — the post-apply certificate of a WYSIWYG selection.set, built from the window the collector materializes for the apply's flushes: a certified edit maps a disjoint older hunk exactly and breaks only the touched block and its separators; an edit in the block next to an older hunk breaks the separator between them (a neighbour dependency); an appended transaction and a mark change spanning blocks are observed and widen the bounded breaks to every block they touch; an unobserved transaction or a capped chain widens to a whole break with its reason; a net-zero edit stays a bounded break, never an identity; a postimage the window did not produce is a whole break
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));

import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { provenanceSessionFor, startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { decodePayload, verifyPayloadTexts } from "@/services/agentJournal/provenance/payload";
import { deleteAndRetype, destroyEditors, flush, load, mapHunk, mount, passStepBudget, posOf, store, typeAfter } from "@/test/wysiwygNetZeroHarness";
import { captureWysiwygApply } from "../wysiwygCollector";
import { wysiwygApplyCertificate } from "../wysiwygCertificate";

const TEXT = "# Title\n\npara one\n\npara two 中文😀\n";
const bind = (c: object) => ({ ...c, document: "d", epoch: "0", basis: "r" });
let stop: (() => void) | null = null;

beforeEach(() => {
  store().initDocument("t1", "", null);
  stop = startProvenanceSessions();
  provenanceSessionFor("t1")!.fork(TEXT).recorded("r0");
  store().setEditorContent("t1", TEXT);
});
afterEach(() => {
  destroyEditors();
  stop?.();
  stop = null;
});

function loaded(editor = mount()): Editor {
  load(editor, TEXT);
  return editor;
}

/** Run `edit` as a selection.set apply runs it (the edit, then the flush) and certify what the capture saw. */
async function certify(editor: Editor, edit: () => void) {
  const { value: post, capture } = captureWysiwygApply(editor, () => {
    edit();
    return flush(editor);
  });
  expect(capture).not.toBeNull();
  const cert = await wysiwygApplyCertificate(capture!, TEXT, post);
  expect(cert).not.toHaveProperty("document");
  expect(cert).not.toHaveProperty("basis");
  // The journal binds the ids; the map then reproduces the applied text.
  await verifyPayloadTexts(bind(cert), TEXT, post);
  return { post, p: decodePayload(bind(cert)) };
}

describe("WYSIWYG selection.set — post-apply certificate", () => {
  it("a certified edit maps a disjoint older hunk exactly and breaks only the touched block and its separators", async () => {
    const editor = loaded();
    const { post, p } = await certify(editor, () => typeAfter(editor, "para two", "Z"));
    expect(post).toBe("# Title\n\npara one\n\npara twoZ 中文😀\n");
    expect(p.whole).toBeNull();
    expect(p.bounded.length).toBeGreaterThan(0);
    expect(p.bounded.every((b) => b.reason === "uncertifiedRange" && b.origin.startsWith("wysiwyg:"))).toBe(true);
    const from = TEXT.indexOf("itl");
    expect(mapHunk(p, TEXT, "itl")).toEqual({ span: { from, to: from + 3, growing: false }, hit: false, edited: false, block: null });
    expect(mapHunk(p, TEXT, "ara on").block).toBeNull();
    expect(mapHunk(p, TEXT, "para two").block).not.toBeNull();
    // The separator before the touched block is part of its break (R20).
    const sep = TEXT.indexOf("\n\npara two");
    expect(p.deletedChars.some(([a, b]) => a <= sep && b >= sep + 1)).toBe(true);
  });

  it("an edit in the block next to an older hunk breaks the separator between them", async () => {
    const editor = loaded();
    const { p } = await certify(editor, () => typeAfter(editor, "para two", "Z"));
    // An older hunk that ends where "para one" ends meets the separator the
    // edit broke; one that stops short of the block's end does not.
    expect(mapHunk(p, TEXT, "one").block).toEqual({ reason: "uncertifiedRange", origin: expect.stringMatching(/^wysiwyg:/) });
    expect(mapHunk(p, TEXT, "para").block).toBeNull();
  });

  it("an appended transaction is observed: its block is broken too, the untouched one still maps", async () => {
    const appendBang = Extension.create({
      name: "appendBangForTest",
      addProseMirrorPlugins: () => [
        new Plugin({
          appendTransaction: (trs, _old, state) => {
            if (!trs.some((tr) => tr.getMeta("appendBang"))) return null;
            let end = -1;
            state.doc.descendants((n, pos) => {
              if (end < 0 && n.type.name === "heading") end = pos + n.nodeSize - 1;
            });
            return state.tr.insertText("!", end);
          },
        }),
      ],
    });
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = loaded(new Editor({ element, extensions: [...createTiptapExtensions(), appendBang, (await import("../wysiwygCollector")).wysiwygProvenanceExtension("t1")] }));
    const { post, p } = await certify(editor, () => {
      editor.view.dispatch(editor.state.tr.insertText("Z", posOf(editor, "para two") + 8).setMeta("appendBang", true));
    });
    editor.destroy();
    expect(post).toBe("# Title!\n\npara one\n\npara twoZ 中文😀\n");
    expect(p.whole).toBeNull();
    expect(mapHunk(p, TEXT, "Title").block).not.toBeNull();
    expect(mapHunk(p, TEXT, "para two").block).not.toBeNull();
    expect(mapHunk(p, TEXT, "ara on").block).toBeNull();
  });

  it("a mark change spanning two blocks breaks both and the separator between them", async () => {
    const editor = loaded();
    const { p } = await certify(editor, () => {
      editor.chain().setTextSelection({ from: posOf(editor, "one"), to: posOf(editor, "para two") + 4 }).toggleBold().run();
    });
    expect(p.whole).toBeNull();
    expect(mapHunk(p, TEXT, "one\n\npara").block).not.toBeNull();
    expect(mapHunk(p, TEXT, "itl").block).toBeNull();
  });

  it("an unobserved transaction during the apply widens to a whole break with its reason", async () => {
    const editor = loaded();
    const { p } = await certify(editor, () => {
      const held = editor.state;
      typeAfter(editor, "para two", "A");
      editor.view.updateState(held);
      typeAfter(editor, "para two", "Z");
    });
    expect(p.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unobserved-transaction" });
  });

  it("a capped chain widens to a whole capOverflow break", async () => {
    const editor = loaded();
    const { p } = await certify(editor, () => {
      const at = posOf(editor, "one");
      passStepBudget(editor, at);
      editor.view.dispatch(editor.state.tr.insertText("Z", at));
    });
    expect(p.whole).toEqual({ reason: "capOverflow", origin: "wysiwyg:chain-cap" });
  });

  it("a net-zero edit stays a bounded break over its block, never an identity", async () => {
    const editor = loaded();
    const { post, p } = await certify(editor, () => deleteAndRetype(editor, "o"));
    expect(post).toBe(TEXT);
    expect(p.whole).toBeNull();
    expect(mapHunk(p, TEXT, "para one").block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });
    expect(mapHunk(p, TEXT, "itl").block).toBeNull();
  });

  it("a postimage the captured window did not produce is a whole break", async () => {
    const editor = loaded();
    const { capture } = captureWysiwygApply(editor, () => {
      typeAfter(editor, "para two", "Z");
      return flush(editor);
    });
    const other = TEXT.replace("Title", "Tidal");
    const p = decodePayload(bind(await wysiwygApplyCertificate(capture!, TEXT, other)));
    expect(p.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unmatched" });
  });

  it("an apply with no flush captures nothing", () => {
    const editor = loaded();
    expect(captureWysiwygApply(editor, () => 1)).toEqual({ value: 1, capture: null });
  });
});
