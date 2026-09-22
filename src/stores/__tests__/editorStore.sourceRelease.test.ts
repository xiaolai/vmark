/**
 * A destroyed Source editor must not stay referenced by the editor store.
 *
 * `clearSourceViewIfMatch` is what SourceEditor calls as its view dies. It
 * used to clear only the `active` slice; the `source` slice kept the dead
 * view — its whole document, state and detached DOM — until the next Source
 * editor mounted, which after a switch to WYSIWYG can be never.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { useEditorStore } from "../editorStore";
import { createEmptyCursorContext } from "@/types/cursorContext";

const views: EditorView[] = [];
function makeView(doc: string): EditorView {
  const view = new EditorView({ doc });
  views.push(view);
  return view;
}

beforeEach(() => {
  useEditorStore.getState().clearSourceContext();
  useEditorStore.getState().clearActiveEditors();
});

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

describe("editorStore.clearSourceViewIfMatch", () => {
  it("releases the source context slice that holds the dying view", () => {
    const view = makeView("# big document");
    const store = useEditorStore.getState();
    store.setActiveSourceView(view, "tab-1");
    store.setSourceContext({ ...createEmptyCursorContext(), hasSelection: true, selectionTo: 5 }, view);

    useEditorStore.getState().clearSourceViewIfMatch(view);

    const { source, active } = useEditorStore.getState();
    expect(source.editorView).toBeNull();
    expect(source.context).toEqual(createEmptyCursorContext());
    expect(active.activeSourceView).toBeNull();
  });

  it("leaves another pane's live registration alone (split view)", () => {
    const dying = makeView("a");
    const live = makeView("b");
    const store = useEditorStore.getState();
    store.setActiveSourceView(live, "tab-2");
    store.setSourceContext(createEmptyCursorContext(), live);

    useEditorStore.getState().clearSourceViewIfMatch(dying);

    const { source, active } = useEditorStore.getState();
    expect(source.editorView).toBe(live);
    expect(active.activeSourceView).toBe(live);
  });

  it("releases the source slice even when the active slice already moved on", () => {
    const dying = makeView("a");
    const other = makeView("b");
    const store = useEditorStore.getState();
    store.setSourceContext(createEmptyCursorContext(), dying);
    store.setActiveSourceView(other, "tab-2");

    useEditorStore.getState().clearSourceViewIfMatch(dying);

    const { source, active } = useEditorStore.getState();
    expect(source.editorView).toBeNull();
    expect(active.activeSourceView).toBe(other);
  });
});
