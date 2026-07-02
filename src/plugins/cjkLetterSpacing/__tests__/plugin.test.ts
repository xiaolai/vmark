/**
 * Tests for cjkLetterSpacing plugin behavior — decoration computation across
 * CJK/Latin boundaries, punctuation splits, incremental doc updates, mapping
 * on selection-only transactions, and setting toggles mid-session.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Plugin } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { CJKLetterSpacing } from "../plugin";
import { useSettingsStore } from "@/stores/settingsStore";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function paragraph(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

/** Instantiate the extension's ProseMirror plugin with the given className. */
function createPlugin(className = "cjk-spacing"): Plugin {
  const plugins = CJKLetterSpacing.config.addProseMirrorPlugins!.call({
    name: "cjkLetterSpacing",
    options: { className },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  } as never) as Plugin[];
  return plugins[0];
}

function createState(paragraphs: string[], plugin: Plugin): EditorState {
  return EditorState.create({
    doc: schema.node("doc", null, paragraphs.map(paragraph)),
    plugins: [plugin],
  });
}

/** Shape of an inline decoration as exposed by DecorationSet.find(). */
interface InlineDeco {
  from: number;
  to: number;
  type: { attrs: { class?: string } };
}

function getDecorations(plugin: Plugin, state: EditorState): InlineDeco[] {
  const pluginState = plugin.getState(state) as { decorations: DecorationSet };
  return pluginState.decorations.find() as unknown as InlineDeco[];
}

function setSpacing(value: "0" | "0.05") {
  useSettingsStore.getState().updateAppearanceSetting("cjkLetterSpacing", value);
}

beforeEach(() => {
  setSpacing("0.05"); // enabled unless a test disables it
});

afterEach(() => {
  setSpacing("0"); // restore default (off)
});

describe("decoration computation on init", () => {
  it("decorates a pure CJK paragraph as a single run", () => {
    const plugin = createPlugin();
    const state = createState(["你好世界"], plugin);
    const decos = getDecorations(plugin, state);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(1);
    expect(decos[0].to).toBe(5);
  });

  it("decorates only CJK runs in mixed CJK/Latin text", () => {
    const plugin = createPlugin();
    // "你好 hello 世界" — CJK at offsets 0-2 and 9-11 within the text node
    const state = createState(["你好 hello 世界"], plugin);
    const decos = getDecorations(plugin, state);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [10, 12],
    ]);
  });

  it("creates no decorations for Latin-only text", () => {
    const plugin = createPlugin();
    const state = createState(["hello world"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(0);
  });

  it("creates no decorations for an empty document", () => {
    const plugin = createPlugin();
    const state = createState([""], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(0);
  });

  it("splits runs at CJK punctuation (fullwidth comma, ideographic period)", () => {
    const plugin = createPlugin();
    // "你好，世界。" — U+FF0C and U+3002 are outside the decorated ranges
    const state = createState(["你好，世界。"], plugin);
    const decos = getDecorations(plugin, state);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [4, 6],
    ]);
  });

  it("decorates CJK runs across multiple paragraphs", () => {
    const plugin = createPlugin();
    const state = createState(["你好", "world", "世界"], plugin);
    const decos = getDecorations(plugin, state);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [12, 14],
    ]);
  });

  it("applies the configured className to decorations", () => {
    const plugin = createPlugin("custom-cjk");
    const state = createState(["你好"], plugin);
    const decos = getDecorations(plugin, state);
    expect(decos).toHaveLength(1);
    expect(decos[0].type.attrs.class).toBe("custom-cjk");
  });

  it("creates no decorations when the setting is disabled", () => {
    setSpacing("0");
    const plugin = createPlugin();
    const state = createState(["你好世界"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(0);
  });
});

describe("selection-only transactions", () => {
  it("keeps decorations unchanged when only the selection moves", () => {
    const plugin = createPlugin();
    const state = createState(["你好世界"], plugin);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 3));
    const next = state.apply(tr);
    const decos = getDecorations(plugin, next);
    expect(decos.map((d) => [d.from, d.to])).toEqual([[1, 5]]);
  });
});

describe("incremental updates on doc change", () => {
  it("adds decorations when CJK text is inserted into Latin text", () => {
    const plugin = createPlugin();
    const state = createState(["hello"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(0);

    const next = state.apply(state.tr.insertText("你好", 1));
    const decos = getDecorations(plugin, next);
    expect(decos.map((d) => [d.from, d.to])).toEqual([[1, 3]]);
  });

  it("splits a decoration when Latin is inserted mid-CJK-run", () => {
    const plugin = createPlugin();
    const state = createState(["你好世界"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(1);

    // "你好世界" → "你好x世界"
    const next = state.apply(state.tr.insertText("x", 3));
    const decos = getDecorations(plugin, next);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [4, 6],
    ]);
  });

  it("merges into a single run when appended CJK extends an existing run", () => {
    const plugin = createPlugin();
    const state = createState(["你好"], plugin);
    const next = state.apply(state.tr.insertText("世界", 3));
    const decos = getDecorations(plugin, next);
    expect(decos.map((d) => [d.from, d.to])).toEqual([[1, 5]]);
  });

  it("removes decorations when CJK text is deleted", () => {
    const plugin = createPlugin();
    const state = createState(["你好"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(1);

    const next = state.apply(state.tr.delete(1, 3));
    expect(getDecorations(plugin, next)).toHaveLength(0);
  });

  it("creates no decorations when Latin is typed into Latin text", () => {
    const plugin = createPlugin();
    const state = createState(["hello"], plugin);
    const next = state.apply(state.tr.insertText(" world", 6));
    expect(getDecorations(plugin, next)).toHaveLength(0);
  });

  it("shifts decorations in later paragraphs when text is inserted before them", () => {
    const plugin = createPlugin();
    const state = createState(["abc", "世界"], plugin);
    // "世界" sits at 6..8 (para 1 spans 0..5)
    expect(getDecorations(plugin, state).map((d) => [d.from, d.to])).toEqual([[6, 8]]);

    const next = state.apply(state.tr.insertText("xy", 1));
    expect(getDecorations(plugin, next).map((d) => [d.from, d.to])).toEqual([[8, 10]]);
  });
});

describe("setting toggles mid-session", () => {
  it("clears decorations when the setting is turned off", () => {
    const plugin = createPlugin();
    const state = createState(["你好"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(1);

    setSpacing("0");
    const next = state.apply(state.tr); // any transaction re-evaluates
    expect(getDecorations(plugin, next)).toHaveLength(0);
  });

  it("rebuilds decorations for the whole doc when the setting is turned on", () => {
    setSpacing("0");
    const plugin = createPlugin();
    const state = createState(["你好", "世界"], plugin);
    expect(getDecorations(plugin, state)).toHaveLength(0);

    setSpacing("0.05");
    const next = state.apply(state.tr);
    const decos = getDecorations(plugin, next);
    expect(decos.map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it("stays cleared while disabled even when the doc changes", () => {
    const plugin = createPlugin();
    const state = createState(["你好"], plugin);
    setSpacing("0");
    const next = state.apply(state.tr.insertText("世界", 3));
    expect(getDecorations(plugin, next)).toHaveLength(0);
  });
});

describe("decorations prop", () => {
  it("exposes the plugin state's decoration set to the view", () => {
    const plugin = createPlugin();
    const state = createState(["你好"], plugin);
    const fromProps = plugin.props.decorations!.call(plugin, state) as DecorationSet;
    expect(fromProps.find()).toHaveLength(1);
  });
});
