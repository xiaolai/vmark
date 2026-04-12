import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { Decoration } from "@tiptap/pm/view";

// Mock the mermaid renderer to reject — covers the try/catch around
// setTimeout's awaited render calls in updateLivePreview.
vi.mock("./renderers/renderMermaidPreview", () => ({
  updateMermaidLivePreview: vi.fn(async () => {
    throw new Error("boom");
  }),
  createMermaidPreviewWidget: vi.fn((nodeEnd: number) =>
    Decoration.widget(nodeEnd, () => document.createElement("div"), {
      key: "mock-mermaid",
    }),
  ),
}));

import {
  codePreviewExtension,
  EDITING_STATE_CHANGED,
} from "./tiptap";

type DecorationLike = { type?: { attrs?: Record<string, string> } };

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
  const plugins =
    codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
  const emptyDoc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(),
  ]);
  const state = EditorState.create({ schema, doc: emptyDoc, plugins });

  const codeBlock = schema.nodes.codeBlock.create(
    { language },
    schema.text(text),
  );
  const nextState = state.apply(
    state.tr.replaceRangeWith(0, state.doc.content.size, codeBlock),
  );

  return { state: nextState, plugins, schema };
}

function makeDispatchView(baseState: EditorState) {
  const mockView = {
    state: baseState,
    dispatch: vi.fn((tr) => {
      mockView.state = mockView.state.apply(tr);
    }),
    focus: vi.fn(),
    composing: false,
    dom: document.createElement("div"),
  };
  return mockView;
}

describe("updateLivePreview error handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders error placeholder and does not emit unhandled rejection when renderer throws", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);

    try {
      const { useBlockMathEditingStore } = await import(
        "@/stores/blockMathEditingStore"
      );
      const { state } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

      let codeBlockPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock" || node.type.name === "code_block") {
          codeBlockPos = pos;
          return false;
        }
        return true;
      });

      useBlockMathEditingStore
        .getState()
        .startEditing(codeBlockPos, "graph TD; A-->B");

      const extensionContext = {
        name: codePreviewExtension.name,
        options: codePreviewExtension.options,
        storage: codePreviewExtension.storage,
        editor: {} as Editor,
        type: null,
        parent: undefined,
      };
      const freshPlugins =
        codePreviewExtension.config.addProseMirrorPlugins?.call(
          extensionContext,
        ) ?? [];
      const mockView = makeDispatchView(state);
      const viewResult = freshPlugins[0].spec.view!(mockView as never);

      const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
      const editingState = state.apply(tr);
      viewResult.update!(
        Object.assign({}, mockView, { state: editingState }) as never,
        {} as never,
      );
      mockView.state = editingState;

      const pluginState = freshPlugins[0].getState(editingState);
      const decs = pluginState.decorations.find();
      const widgetDecs = decs.filter(
        (d: DecorationLike) => !d.type?.attrs?.class,
      );

      // The live preview widget is the last widget decoration (side=1).
      const livePreviewDec = widgetDecs[widgetDecs.length - 1];
      const previewEl = (livePreviewDec as any).type.toDOM(mockView);
      expect(previewEl).toBeInstanceOf(HTMLElement);

      // Fire the debounced callback; mocked renderer rejects with "boom".
      await vi.runAllTimersAsync();
      // Let microtasks flush so the catch runs.
      await Promise.resolve();
      await Promise.resolve();

      expect(previewEl.innerHTML).toContain("code-block-live-preview-error");

      useBlockMathEditingStore.getState().exitEditing();
      viewResult.destroy!();
    } finally {
      process.off("unhandledRejection", onRejection);
    }

    expect(rejections).toEqual([]);
  });
});
