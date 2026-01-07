import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension } from "./tiptap";

function createStateWithCodeBlock(language: string, text: string) {
  const schema = getSchema([StarterKit]);
  const extensionContext = {
    name: codePreviewExtension.name,
    options: codePreviewExtension.options,
    storage: codePreviewExtension.storage,
    editor: {} as Editor,
    type: null,
    parent: undefined,
  };
  const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
  const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
  const state = EditorState.create({ schema, doc: emptyDoc, plugins });

  const codeBlock = schema.nodes.codeBlock.create({ language }, schema.text(text));
  const nextState = state.apply(
    state.tr.replaceRangeWith(0, state.doc.content.size, codeBlock)
  );

  return { state: nextState, plugins };
}

describe("codePreviewExtension", () => {
  it("adds preview-only class for mermaid code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const decorations = plugins[0].getState(state);
    const matches = decorations.find().filter((decoration: { type?: { attrs?: Record<string, string> } }) => {
      const attrs = decoration.type?.attrs;
      return attrs?.class?.includes("code-block-preview-only");
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not add preview-only class for non-preview languages", () => {
    const { state, plugins } = createStateWithCodeBlock("js", "const a = 1;");
    const decorations = plugins[0].getState(state);
    const matches = decorations.find().filter((decoration: { type?: { attrs?: Record<string, string> } }) => {
      const attrs = decoration.type?.attrs;
      return attrs?.class?.includes("code-block-preview-only");
    });
    expect(matches.length).toBe(0);
  });

  it("marks preview-only code blocks as non-editable", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "\\frac{1}{2}");
    const decorations = plugins[0].getState(state);
    const match = decorations.find().find((decoration: { type?: { attrs?: Record<string, string> } }) => {
      const attrs = decoration.type?.attrs;
      return attrs?.class?.includes("code-block-preview-only");
    });
    const attrs = match?.type?.attrs ?? {};
    expect(attrs.contenteditable).toBe("false");
  });
});
