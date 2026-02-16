import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { saveImageChanges } from "../sourceImageActions";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("source image actions", () => {
  afterEach(() => {
    useMediaPopupStore.getState().closePopup();
  });

  it("preserves title and angle-bracket destination when saving", () => {
    const doc = 'Image ![alt](<path with space> "Title") end.';
    const imageText = '![alt](<path with space> "Title")';
    const imageFrom = doc.indexOf(imageText);
    const view = createView(doc);

    useMediaPopupStore.setState({
      isOpen: true,
      mediaSrc: "new path",
      mediaAlt: "alt",
      mediaNodePos: imageFrom,
      mediaNodeType: "image",
      anchorRect: null,
    });

    saveImageChanges(view);

    expect(view.state.doc.toString()).toBe(
      'Image ![alt](<new path> "Title") end.'
    );

    view.destroy();
  });
});
