/**
 * Smart select-all: expansion terminates, and undo preserves direction.
 *
 * Two defects an audit found, both reachable with ordinary keystrokes.
 *
 *   1. The whole-document guard ran INSIDE the later branches, after block
 *      detection. On a document whose first block is detectable, a third
 *      Mod-A fell past both branches and SHRANK the selection back to that
 *      block — expansion that goes backwards.
 *   2. The undo stored normalised `from`/`to`, so a right-to-left selection
 *      came back with the caret at the opposite end and the next arrow key
 *      moved the wrong way.
 *
 * @coordinates-with plugins/codemirror/sourceShortcuts.ts
 * @module plugins/codemirror/__tests__/smartSelectAll.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useShortcutsStore } from "@/stores/settingsStore";
import { buildSourceShortcutKeymap } from "../sourceShortcuts";

/** A document whose FIRST block is a detectable fenced code block. */
const DOC = "```js\nconst x = 1;\n```\n\nTrailing prose paragraph.\n";

function makeView(doc = DOC): EditorView {
  return new EditorView({ state: EditorState.create({ doc }) });
}

const runFor = (key: string) => {
  const binding = buildSourceShortcutKeymap().find((b) => b.key === key);
  expect(binding).toBeDefined();
  return binding!.run!;
};

beforeEach(() => {
  useShortcutsStore.setState({ customBindings: {} } as never);
});

describe("expansion terminates at the whole document", () => {
  it("a third press does not shrink the selection back to a block", () => {
    const view = makeView();
    const run = runFor("Mod-a");

    view.dispatch({ selection: { anchor: 8, head: 8 } }); // inside the fence
    run(view);
    const afterFirst = view.state.selection.main;
    run(view);
    const afterSecond = view.state.selection.main;
    run(view);
    const afterThird = view.state.selection.main;

    expect(afterFirst.to - afterFirst.from).toBeLessThan(view.state.doc.length);
    expect(afterSecond.from).toBe(0);
    expect(afterSecond.to).toBe(view.state.doc.length);
    // The defect: this became the block again.
    expect(afterThird.from).toBe(0);
    expect(afterThird.to).toBe(view.state.doc.length);
  });

  it("stays selected however many times it is pressed", () => {
    const view = makeView();
    const run = runFor("Mod-a");
    view.dispatch({ selection: { anchor: 8, head: 8 } });

    for (let i = 0; i < 6; i += 1) run(view);

    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
  });

  it("consumes the key even when already fully selected", () => {
    // Returning false would hand the event to the browser, whose page-wide
    // select-all highlights the sidebar too.
    const view = makeView();
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

    expect(runFor("Mod-a")(view)).toBe(true);
  });
});

describe("undo restores the selection's DIRECTION", () => {
  it("a backward selection comes back backward", () => {
    const view = makeView();
    const selectAll = runFor("Mod-a");
    const undo = runFor("Mod-z");

    // Dragged right-to-left: head BEFORE anchor.
    view.dispatch({ selection: { anchor: 12, head: 8 } });
    selectAll(view);
    undo(view);

    const restored = view.state.selection.main;
    expect(restored.anchor).toBe(12);
    expect(restored.head).toBe(8);
  });

  it("a forward selection comes back forward", () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: 8, head: 12 } });
    runFor("Mod-a")(view);
    runFor("Mod-z")(view);

    const restored = view.state.selection.main;
    expect(restored.anchor).toBe(8);
    expect(restored.head).toBe(12);
  });

  it("declines when the selection moved since the expansion", () => {
    const view = makeView();
    runFor("Mod-a")(view);
    view.dispatch({ selection: { anchor: 3, head: 3 } });

    expect(runFor("Mod-z")(view)).toBe(false);
  });

  it("declines when there was no expansion to undo", () => {
    expect(runFor("Mod-z")(makeView())).toBe(false);
  });
});

describe("an UNTERMINATED fence selects all of its content", () => {
  // `endLine` means the closing fence when there is one, and the last document
  // line when there is not. Treating both as a delimiter dropped the final
  // content line, and returned nothing at all for a one-line fence.
  const selectBlock = (doc: string, cursor: number) => {
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: cursor, head: cursor } });
    runFor("Mod-a")(view);
    const { from, to } = view.state.selection.main;
    return doc.slice(from, to);
  };

  it("selects the ONE content line of a one-line unterminated fence", () => {
    const doc = "```js\nconst x = 1;";
    expect(selectBlock(doc, doc.indexOf("const"))).toBe("const x = 1;");
  });

  it("does not drop the final line of a multi-line unterminated fence", () => {
    const doc = "```js\nconst a = 1;\nconst b = 2;\nconst c = 3;";
    expect(selectBlock(doc, doc.indexOf("const b"))).toBe(
      "const a = 1;\nconst b = 2;\nconst c = 3;"
    );
  });

  it("still excludes the closing delimiter of a CLOSED fence", () => {
    const doc = "```js\nconst a = 1;\nconst b = 2;\n```\n";
    expect(selectBlock(doc, doc.indexOf("const b"))).toBe("const a = 1;\nconst b = 2;");
  });

  it("selects nothing for an empty closed fence", () => {
    // No content lines at all — expansion falls through to whole-document.
    const doc = "```js\n```\n";
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: 7, head: 7 } });
    runFor("Mod-a")(view);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
  });
});
