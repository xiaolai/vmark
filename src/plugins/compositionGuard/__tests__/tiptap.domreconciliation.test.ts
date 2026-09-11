/**
 * Regression tests for #1392 — a committed CJK candidate surviving WebKit's
 * table-cell composition damage.
 *
 * Replays the DOM mutation macOS WebKit makes when a composition ends in an
 * OTHERWISE EMPTY table cell: it tears out the cell's paragraph and drops a BR
 * plus the composed text under the TR, beside the cell (prosemirror-view #188).
 * ProseMirror's own recovery moves the text back, then re-parses the range. The
 * rebuilt paragraph has no `sourceLine` (that attribute is internal — never
 * rendered, never parsed), so the diff spans the whole node and SHRINKS, which
 * matches `looksLikeBackspace` in domchange.ts. ProseMirror then asks the key
 * handlers about a Backspace it synthesized and never dispatched; the guard used
 * to answer "handled", and the parsed replacement was thrown away.
 *
 * These tests exercise DOM reconciliation, not the OS candidate window. The
 * jsdom environment is required — the subject is a real ProseMirror document
 * view. `sourceLine` must stay on the pre-damage paragraph: without it the diff
 * is an ordinary text replacement and the test would pass for the wrong reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, Node, type JSONContent } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import type { EditorView } from "@tiptap/pm/view";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import { withSourceLine } from "@/plugins/shared/sourceLineAttr";
import {
  ParagraphWithSourceLine,
  TableRowWithSourceLine,
} from "@/plugins/shared/sourceLineNodes";
import { markProseMirrorCompositionEnd } from "@/utils/imeGuard";
import { compositionGuardExtension } from "../tiptap";

/**
 * Production wraps this same extension in a horizontal-scroll node view
 * (`plugins/tableScroll`). That wrapper sits OUTSIDE the table and plays no
 * part in damage WebKit does at TR level, and a plugin test may not import
 * another plugin (the `plugin-isolation` dependency-cruiser rule), so the
 * attribute half — which is what the diff turns on — is reproduced here.
 */
const TableWithSourceLine = withSourceLine(Table);

/**
 * Test-only access to the pinned ProseMirror internals this replay needs.
 * `badSafariComposition` is set by the DOM observer only under a real WebKit
 * user agent, so jsdom has to raise it by hand to reach the recovery path.
 */
type ReconciliationView = EditorView & {
  input: { badSafariComposition: boolean };
  domObserver: { flush(): void };
};

let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  // Freeze the clock so the whole synchronous replay sits inside the real IME
  // grace period regardless of machine load. The guard itself is not mocked.
  vi.spyOn(performance, "now").mockReturnValue(1000);
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [
      Node.create({ name: "doc", topNode: true, content: "block+" }),
      Node.create({ name: "text", group: "inline" }),
      ParagraphWithSourceLine,
      TableWithSourceLine.configure({ resizable: false }),
      TableRowWithSourceLine,
      AlignedTableHeader,
      AlignedTableCell,
      compositionGuardExtension,
    ],
    editorProps: { handleScrollToSelection: () => true },
  });
});

afterEach(() => {
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
});

/** A two-row table whose body cell at `column` still holds the pinyin draft. */
function tableDraft(column: number, draft: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { sourceLine: 1 },
        content: ["tableHeader", "tableCell"].map((type, row) => ({
          type: "tableRow",
          attrs: { sourceLine: row + 1 },
          content: [0, 1, 2].map((index) => ({
            type,
            attrs: { sourceLine: row + 1 },
            content: [
              {
                type: "paragraph",
                attrs: { sourceLine: row + 1, blankLinesBefore: null },
                content: [
                  {
                    type: "text",
                    text: row === 1 && index === column ? draft : `cell-${row}-${index}`,
                  },
                ],
              },
            ],
          })),
        })),
      },
    ],
  };
}

describe("table IME DOM reconciliation", () => {
  it.each([
    { column: 0, draft: "lu", committed: "路" },
    { column: 1, draft: "lu", committed: "路" },
    { column: 2, draft: "lu", committed: "路" },
    { column: 0, draft: "nihao", committed: "你好" },
  ])("keeps $committed in column $column after committing $draft", ({ column, draft, committed }) => {
    editor.commands.setContent(tableDraft(column, draft));
    const view = editor.view as ReconciliationView;
    const cell = [...view.dom.querySelectorAll("td")][column];
    const paragraph = cell.querySelector("p")!;
    const from = view.posAtDOM(paragraph, 0);
    editor.commands.setTextSelection(from + draft.length);
    // Precondition, not decoration: sourceLine is what the rebuilt paragraph
    // loses, and losing it is what turns this into a backspace-shaped diff.
    expect(view.state.doc.resolve(from).parent.attrs.sourceLine).toBe(2);

    // The recorded damage: paragraph gone, candidate text beside the cell.
    paragraph.remove();
    const br = document.createElement("br");
    const text = document.createTextNode(committed);
    cell.before(br, text);
    window.getSelection()!.collapse(text, committed.length);
    markProseMirrorCompositionEnd(view);
    view.input.badSafariComposition = true;
    view.domObserver.flush();

    const row = view.state.doc.firstChild!.child(1);
    expect(row.child(column).textContent).toBe(committed);
    expect(view.dom.querySelectorAll("td")[column].textContent).toBe(committed);
    expect(row.childCount).toBe(3);
    for (const neighbour of [0, 1, 2].filter((index) => index !== column)) {
      expect(row.child(neighbour).textContent).toBe(`cell-1-${neighbour}`);
    }
  });
});

describe("composition guard key boundary", () => {
  /**
   * The guard's own handler, asked in isolation. Going through
   * `someProp("handleKeyDown")` would answer for the whole plugin chain — a
   * keymap legitimately claims a synthesized Enter, which is ProseMirror's
   * intent, and would mask what this test is about.
   */
  function guardHandler() {
    const owners = editor.state.plugins.filter(
      (plugin) => plugin.spec.filterTransaction && plugin.props.handleKeyDown
    );
    expect(owners).toHaveLength(1);
    return (event: KeyboardEvent) =>
      Boolean(owners[0].props.handleKeyDown!.call(owners[0], editor.view, event));
  }

  /** Build the event the way prosemirror-view's keyEvent() does: never dispatched. */
  function synthesizedKey(keyCode: number, key: string): KeyboardEvent {
    const event = document.createEvent("Event");
    event.initEvent("keydown", true, true);
    Object.assign(event, { keyCode, key, code: key });
    expect(event.target).toBeNull();
    return event as unknown as KeyboardEvent;
  }

  /** Send a real keystroke through the full ProseMirror keydown pipeline. */
  function pressKey(key: string, keyCode: number): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  it.each([
    { key: "Backspace", keyCode: 8 },
    // The same door, one key over: domchange.ts synthesizes Enter as well, and
    // claiming it would discard the parsed change for exactly the same reason.
    { key: "Enter", keyCode: 13 },
  ])("lets a synthesized $key through during the grace period", ({ key, keyCode }) => {
    markProseMirrorCompositionEnd(editor.view);
    expect(guardHandler()(synthesizedKey(keyCode, key))).toBe(false);
  });

  it("still suppresses a real keystroke during the grace period", () => {
    markProseMirrorCompositionEnd(editor.view);
    expect(pressKey("a", 65).defaultPrevented).toBe(true);
  });

  it("leaves a real keystroke alone outside the grace period", () => {
    expect(pressKey("a", 65).defaultPrevented).toBe(false);
  });
});
