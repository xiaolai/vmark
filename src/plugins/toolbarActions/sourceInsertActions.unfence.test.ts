// Audit 20260907 (#444): the code-block TOGGLE's unfence half replaced the
// opener line through the closer with only the interior lines, so a fence that
// opened a list item (`- ```) lost its list marker — the item, and with it the
// list's structure, was destroyed on the way out of the fence.
import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertCodeBlock } from "./sourceInsertActions";

const views: EditorView[] = [];

function createView(doc: string, cursor: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.cursor(cursor) }),
    parent: document.createElement("div"),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("insertCodeBlock — unfencing inside a list item (#444)", () => {
  it("keeps the item's marker on the first body line", () => {
    const doc = "- ```\n  code\n  ```\n- next item";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- code\n- next item");
  });

  it("keeps an ordered marker and the following body lines' indentation", () => {
    const doc = "1. ```js\n   first\n   second\n   ```";
    const view = createView(doc, doc.indexOf("first"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("1. first\n   second");
  });

  it("keeps a quoted list marker", () => {
    const doc = "> - ```\n>   code\n>   ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("> - code");
  });

  it("an empty fence in an item unfences to an empty item, not a vanished one", () => {
    const doc = "- ```\n  ```\n- other";
    const view = createView(doc, 3);
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- \n- other");
  });

  it("a top-level fence is unchanged by the list rule", () => {
    const doc = "```\ncode\n```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("code");
  });
});

// Round 2 (#444): the marker was restored, but the first body line's leading
// whitespace was consumed WHOLE before the content-column strip ran, so the
// indentation the fence's own content carried — beyond the item's continuation
// column — was deleted with it.
describe("insertCodeBlock — unfencing keeps the first body line's own indentation (#444)", () => {
  it("strips only the item's content column, not the code's indentation", () => {
    const doc = "- ```\n      deeply indented\n  ```";
    const view = createView(doc, doc.indexOf("deeply"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("-     deeply indented");
  });

  it("a nested item strips its own indent and content column, keeping the rest", () => {
    // The closer sits at column 2, below the inner item's content column (4):
    // `fenceScanner`'s absolute 0-3 rule closes on it. Since audit R2 #874 a
    // closer AT the content column closes too — see the last case in this block.
    const doc = "- outer\n  - ```\n      code\n  ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- outer\n  -   code");
  });

  it("a quoted item keeps the indentation past its content column", () => {
    const doc = "> - ```\n>     code\n>   ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("> -   code");
  });

  it("an ordered marker strips exactly its own width", () => {
    const doc = "10. ```\n        eight\n```";
    const view = createView(doc, doc.indexOf("eight"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("10.     eight");
  });

  // The counterpart: CommonMark measures a closing fence's indent from the
  // CONTAINER'S content column, so an item whose content starts at column 2 is
  // closed by a fence at columns 2-5. This case asserted the opposite until
  // audit R2 #874 — measured against remark-parse, which gives
  // `- ``` ` / `  code` / `    ``` ` ONE closed code block whose value is
  // "code", so the closer here is a delimiter and unfencing consumes it.
  it("closes on a closer within three columns of the item's content column", () => {
    const doc = "- ```\n  code\n    ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- code");
  });

});

// Round 3 (#444): restoration captured ONE list marker, so a fence opened by a
// nested item (`- - ```) came back with the inner marker replaced by spaces —
// the inner list was destroyed exactly as the outer one had been. The opener's
// whole container prefix is the item, however many markers it nests.
describe("insertCodeBlock — unfencing restores every nested list marker (#444)", () => {
  it("keeps both markers of a doubly-nested item", () => {
    const doc = "- - ```\n    code\n  ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- - code");
  });

  it("keeps the code's own indentation past the nested item's content column", () => {
    const doc = "- - ```\n      code\n  ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- -   code");
  });

  it("keeps an ordered outer marker and a bullet inner one", () => {
    const doc = "1. - ```\n     code\n   ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("1. - code");
  });

  it("keeps a quote that follows the marker, whose continuation the body repeats", () => {
    const doc = "- > ```\n  > code\n  > ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- > code");
  });

  it("keeps three nested markers", () => {
    const doc = "- - - ```\n      code\n  ```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("- - - code");
  });
});

// Audit R2 (#878): the continuation strip measured list widths in UTF-16
// LENGTHS and matched literal spaces only, so a tab-padded marker consumed
// nothing from a tab-indented body line — the marker was re-emitted AND the
// tab kept, moving the code a whole tab stop to the right.
describe("insertCodeBlock — unfencing measures the continuation in COLUMNS (#878)", () => {
  it("consumes a tab that stands for a tab-padded marker's width", () => {
    const doc = "-\t```\n\tcode\n```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("-\tcode");
  });

  it("re-expands the columns of a straddling tab that the item does not own", () => {
    // `- ` is two columns; the body's tab reaches column 4, so two columns
    // past the item's content column are the code's own indentation.
    const doc = "- ```\n\tcode\n```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("-   code");
  });

  it("leaves a body line with no continuation whitespace alone", () => {
    const doc = "-\t```\ncode\n```";
    const view = createView(doc, doc.indexOf("code"));
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("-\tcode");
  });
});
