/**
 * Shared fixtures for the codePreview test suite (split per the test-file
 * size gate, WI-7). State factory + decoration helpers used by every
 * tiptap.*.test.ts sibling.
 */
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension } from "@/plugins/codePreview/tiptap";

export function createStateWithCodeBlock(language: string, text: string) {
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

  return { state: nextState, plugins, schema };
}

export type DecorationLike = { type?: { attrs?: Record<string, string> } };

export function findDecorationsByClass(decorations: DecorationLike[], className: string) {
  return decorations.filter((d) => d.type?.attrs?.class?.includes(className));
}
