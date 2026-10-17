// WI-OC2.3 — CJK letter spacing does its whole-document work at most once per
// load, and none while the setting is off (#1565).
//
// Two defects, both measured on the reporter's fixture. The WYSIWYG host never
// passed the setting to the plugin, so it decorated every CJK run even with
// spacing off — the default — where the decorations change nothing on screen.
// And the plugin widened each changed range to the parent of its start, which
// for a change between blocks is the whole document: Tiptap's trailing-node
// insertion after a final code block rescanned the document a second time.
//
// Driven through the production extension list and the real load write, on a
// document that ends in a code block.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Plugin } from "@tiptap/pm/state";
import { Decoration, type DecorationSet } from "@tiptap/pm/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { setContentWithoutHistory } from "@/components/Editor/tiptapContentLoad";
import { createTiptapExtensions } from "./createTiptapExtensions";

const CJK_RUN = /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯㄀-ㄯ]+/g;

let editor: Editor | null = null;
let inline: MockInstance<typeof Decoration.inline>;

type Spacing = ReturnType<typeof useSettingsStore.getState>["appearance"]["cjkLetterSpacing"];

function setSpacing(value: Spacing) {
  useSettingsStore.setState((state) => ({ appearance: { ...state.appearance, cjkLetterSpacing: value } }));
}

beforeEach(() => {
  inline = vi.spyOn(Decoration, "inline");
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  inline.mockRestore();
  setSpacing("0");
});

/** Headings and CJK paragraphs, ending in a code block, as the fixture does. */
function fixtureDoc(host: Editor): PMNode {
  const text = (value: string) => ({ type: "text", text: value });
  const blocks = [];
  for (let i = 0; i < 20; i++) {
    blocks.push({ type: "heading", attrs: { level: 2 }, content: [text(`第${i}章 标题`)] });
    blocks.push({ type: "paragraph", content: [text("中文段落，含 English 与かな。漢字が続く")] });
  }
  blocks.push({ type: "codeBlock", attrs: { language: "text" }, content: [text("代码 code")] });
  return host.schema.nodeFromJSON({ type: "doc", content: blocks });
}

function mount(): Editor {
  editor = new Editor({ element: document.createElement("div"), extensions: createTiptapExtensions({ tabId: "tab-1" }) });
  return editor;
}

function spacingDecorations(host: Editor): DecorationSet | undefined {
  const plugin = host.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith("cjkLetterSpacing$")) as
    | Plugin<{ decorations: DecorationSet }>
    | undefined;
  return plugin?.getState(host.state)?.decorations;
}

/** Every CJK run in the document, as a fresh full scan finds them. */
function runsOf(doc: PMNode): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(CJK_RUN)) runs.push([pos + match.index, pos + match.index + match[0].length]);
  });
  return runs;
}

function decoratedRuns(host: Editor): Array<[number, number]> {
  return (spacingDecorations(host)?.find() ?? []).map((d) => [d.from, d.to] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const spacingCalls = () => inline.mock.calls.filter(([, , attrs]) => attrs?.class === "cjk-spacing").length;

describe("CJK letter spacing at load", () => {
  it("builds nothing while spacing is off, the default", () => {
    setSpacing("0");
    const host = mount();
    setContentWithoutHistory(host, fixtureDoc(host));

    expect(spacingCalls()).toBe(0);
    expect(decoratedRuns(host)).toEqual([]);
  });

  it("scans a loaded document once, though it ends in a code block", () => {
    setSpacing("0.05");
    const host = mount();
    const doc = fixtureDoc(host);
    setContentWithoutHistory(host, doc);

    // The trailing paragraph Tiptap appends after the code block is there…
    expect(host.state.doc.lastChild?.type.name).toBe("paragraph");
    // …and cost no second scan.
    expect(spacingCalls()).toBe(runsOf(doc).length);
    expect(decoratedRuns(host)).toEqual(runsOf(host.state.doc));
  });

  it("follows the setting: on rebuilds, off clears", () => {
    setSpacing("0");
    const host = mount();
    setContentWithoutHistory(host, fixtureDoc(host));

    setSpacing("0.05");
    host.view.dispatch(host.state.tr.setMeta("cjkLetterSpacingChanged", true));
    expect(decoratedRuns(host)).toEqual(runsOf(host.state.doc));

    setSpacing("0");
    host.view.dispatch(host.state.tr.setMeta("cjkLetterSpacingChanged", true));
    expect(decoratedRuns(host)).toEqual([]);
  });

  it("keeps matching a full scan through edits inside, between and after blocks", () => {
    setSpacing("0.05");
    const host = mount();
    setContentWithoutHistory(host, fixtureDoc(host));
    const second = host.state.doc.child(0).nodeSize + 1;

    host.commands.insertContentAt(second + 2, "汉字");
    host.commands.insertContentAt(host.state.doc.child(0).nodeSize, { type: "paragraph", content: [{ type: "text", text: "新段落" }] });
    host.commands.insertContentAt(host.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "末尾の文" }] });
    host.view.dispatch(host.state.tr.delete(second, second + 8));

    expect(decoratedRuns(host)).toEqual(runsOf(host.state.doc));
  });
});
