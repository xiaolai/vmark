import { describe, it, expect, vi, afterEach } from "vitest";
import { Schema, Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension, SETTINGS_CHANGED } from "../tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "" } },
    },
    text: { inline: true },
  },
});

describe("code preview position mapping", () => {
  it("maps code block position after paragraph edit", () => {
    const doc = schema.node("doc", null, [
      schema.nodes.paragraph.create(null, [schema.text("hello")]),
      schema.nodes.code_block.create({ language: "mermaid" }, [
        schema.text("graph TD"),
      ]),
    ]);

    const state = EditorState.create({ doc, schema });
    let codePos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "code_block") codePos = pos;
    });

    // Insert text in paragraph (before code block)
    const tr = state.tr.insertText(" world", 6);
    const mapped = tr.mapping.map(codePos);

    expect(tr.doc.nodeAt(mapped)?.type.name).toBe("code_block");
  });

  it("detects when change intersects code block", () => {
    const doc = schema.node("doc", null, [
      schema.nodes.paragraph.create(null, [schema.text("hello")]),
      schema.nodes.code_block.create({ language: "latex" }, [
        schema.text("x^2"),
      ]),
    ]);

    const state = EditorState.create({ doc, schema });
    let codePos = -1;
    let codeEnd = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "code_block") {
        codePos = pos;
        codeEnd = pos + node.nodeSize;
      }
    });

    // Edit inside code block
    const tr = state.tr.insertText("+y", codePos + 2);
    let intersectsCode = false;
    tr.mapping.maps[0].forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      if (newFrom < codeEnd && newTo > codePos) intersectsCode = true;
    });

    expect(intersectsCode).toBe(true);
  });

  it("detects when change does NOT intersect code block", () => {
    const doc = schema.node("doc", null, [
      schema.nodes.paragraph.create(null, [schema.text("hello")]),
      schema.nodes.code_block.create({ language: "latex" }, [
        schema.text("x^2"),
      ]),
    ]);

    const state = EditorState.create({ doc, schema });
    let codePos = -1;
    let codeEnd = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "code_block") {
        codePos = pos;
        codeEnd = pos + node.nodeSize;
      }
    });

    // Edit in paragraph (before code block)
    const tr = state.tr.insertText(" world", 6);
    const mappedPos = tr.mapping.map(codePos);
    const mappedEnd = tr.mapping.map(codeEnd);
    let intersectsCode = false;
    tr.mapping.maps[0].forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      if (newFrom < mappedEnd && newTo > mappedPos) intersectsCode = true;
    });

    expect(intersectsCode).toBe(false);
  });
});

// Audit F15 — the incremental fast path must count previewable code blocks at
// ANY depth (the decoration builder scans with descendants()), otherwise a
// nested previewable block can be inserted without decorations being rebuilt.
describe("code preview fast path with nested code blocks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createPluginState(
    makeNodes: (schema: ReturnType<typeof getSchema>) => PMNode[],
  ) {
    const schema = getSchema([StarterKit]);
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const doc = schema.nodes.doc.create(null, makeNodes(schema));
    const state = EditorState.create({ schema, doc, plugins });
    // init() returns an empty decoration set — force the first full build.
    const built = state.apply(state.tr.setMeta(SETTINGS_CHANGED, true));
    return { state: built, plugins, schema };
  }

  it("rebuilds when a previewable block nested in a blockquote is inserted", () => {
    const { state, plugins, schema } = createPluginState((s) => [
      s.nodes.codeBlock.create({ language: "mermaid" }, s.text("graph TD")),
      s.nodes.paragraph.create(null, s.text("hello")),
    ]);
    expect(plugins[0].getState(state).codeBlockRanges.length).toBe(1);

    // Insert blockquote > codeBlock(mermaid) at the end — the change does not
    // intersect the tracked top-level block's range.
    const nested = schema.nodes.blockquote.create(null, [
      schema.nodes.codeBlock.create({ language: "mermaid" }, schema.text("graph LR")),
    ]);
    const after = state.apply(state.tr.insert(state.doc.content.size, nested));

    // Both blocks (top-level + nested) must now be tracked with decorations.
    expect(plugins[0].getState(after).codeBlockRanges.length).toBe(2);
  });

  it("keeps the mapping fast path when typing prose while a NESTED previewable block exists", () => {
    const { state, plugins } = createPluginState((s) => [
      s.nodes.paragraph.create(null, s.text("hello")),
      s.nodes.blockquote.create(null, [
        s.nodes.codeBlock.create({ language: "mermaid" }, s.text("graph TD")),
      ]),
    ]);
    expect(plugins[0].getState(state).codeBlockRanges.length).toBe(1);

    // Typing in the paragraph must map the existing decorations, not run the
    // full descendants() rebuild — the nested block counts toward the total.
    const descSpy = vi.spyOn(PMNode.prototype, "descendants");
    const after = state.apply(state.tr.insertText("!", 6));
    expect(descSpy).not.toHaveBeenCalled();
    expect(plugins[0].getState(after).codeBlockRanges.length).toBe(1);
  });
});
