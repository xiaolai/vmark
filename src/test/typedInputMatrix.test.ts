/**
 * WI-1.3 — the typed-input matrix: VMark's input-rule inventory exercised
 * through the production stack, data-driven.
 *
 * Each case types real characters through the typing harness (WI-1.2) and
 * asserts THREE independent things:
 *   1. the resulting document's top-level block shape,
 *   2. the serialized markdown (the production serializer's exact output),
 *   3. history undo inverts back to the initial document within a bounded
 *      number of steps (grouping differs per rule, so the bound — not a
 *      single step — is the invariant).
 * Cases flagged `backspaceReverts` additionally assert IMMEDIATE reversal:
 * one Backspace right after a rule fires runs `undoInputRule` and restores
 * the literal typed text — a separate contract from history undo.
 *
 * Every expectation is MEASURED production behavior, pinned — never a
 * transplanted golden (case ideas were mined from Lexical's shortcut tables
 * and Milkdown's input/ catalog, expectations from VMark itself). Two
 * standing behaviors this file pins deliberately:
 *   - every block rule leaves a trailing empty paragraph (serialized as a
 *     trailing blank line; collapses on reparse);
 *   - `==highlight==` and `- [ ] ` task syntax have NO input rules — typed
 *     literally they stay text, and the matrix asserts that so an
 *     accidentally-added rule (or a silently-vanished one) is a visible
 *     diff here, not a surprise.
 *
 * Building this matrix found and fixed a production crash:
 * cjkLetterSpacing's incremental decoration update resolved per-step map
 * coordinates against the final doc, throwing `Position N out of range`
 * whenever a mark input rule fired with nothing after the edit
 * (multi-step shrinking transaction). See plugin.test.ts's regression case.
 *
 * @coordinates-with typingHarness.ts — the driver
 * @coordinates-with src/plugins/markInputRules/tiptap.ts — the mark rules
 * @coordinates-with src/plugins/autoPair/ — backtick machine + type-over
 * @module test/typedInputMatrix.test
 */
import { describe, it, expect } from "vitest";
import { withTypingSession, type TypingSession } from "./typingHarness";

interface MatrixCase {
  name: string;
  typed: string;
  /** Expected top-level node type names after typing. */
  blocks: string[];
  /** Expected serialized markdown after typing. */
  markdown: string;
  /** Assert one immediate Backspace produces this markdown (undoInputRule). */
  backspaceReverts?: string;
  /** Inline mark presence probes: [markName, present?] */
  probes?: [string, boolean][];
}

function markNames(s: TypingSession): Set<string> {
  const names = new Set<string>();
  s.editor.state.doc.descendants((node) => {
    for (const m of node.marks) names.add(m.type.name);
  });
  return names;
}

function topBlocks(s: TypingSession): string[] {
  const blocks: string[] = [];
  s.editor.state.doc.forEach((node) => blocks.push(node.type.name));
  return blocks;
}

const CASES: MatrixCase[] = [
  // ── Block rules (all leave a trailing empty paragraph) ────────────────
  {
    name: "heading 1 via '# '",
    typed: "# Title",
    blocks: ["heading", "paragraph"],
    markdown: "# Title\n\n",
  },
  {
    name: "heading 3 via '### '",
    typed: "### Deep",
    blocks: ["heading", "paragraph"],
    markdown: "### Deep\n\n",
  },
  {
    name: "blockquote via '> '",
    typed: "> quoted",
    blocks: ["blockquote", "paragraph"],
    markdown: "> quoted\n\n",
  },
  {
    name: "bullet list via '- '",
    typed: "- item",
    blocks: ["bulletList", "paragraph"],
    markdown: "- item\n\n",
  },
  {
    name: "ordered list via '1. '",
    typed: "1. first",
    blocks: ["orderedList", "paragraph"],
    markdown: "1. first\n\n",
  },
  {
    name: "ordered list respects custom start '3. '",
    typed: "3. third",
    blocks: ["orderedList", "paragraph"],
    markdown: "3. third\n\n",
  },
  {
    name: "horizontal rule via '---'",
    typed: "---",
    blocks: ["horizontalRule", "paragraph"],
    markdown: "---\n\n",
  },
  // ── Inline mark rules ─────────────────────────────────────────────────
  {
    name: "bold via **text**",
    typed: "a **bold** b",
    blocks: ["paragraph"],
    markdown: "a **bold** b\n",
    probes: [["bold", true]],
  },
  {
    name: "italic via *text*",
    typed: "a *it* b",
    blocks: ["paragraph"],
    markdown: "a *it* b\n",
    probes: [["italic", true]],
  },
  {
    name: "bold via __text__ normalizes to ** on serialize",
    typed: "a __bold__ b",
    blocks: ["paragraph"],
    markdown: "a **bold** b\n",
    probes: [["bold", true]],
  },
  {
    name: "italic via _text_ normalizes to * on serialize",
    typed: "a _it_ b",
    blocks: ["paragraph"],
    markdown: "a *it* b\n",
    probes: [["italic", true]],
  },
  {
    name: "strikethrough via ~~text~~",
    typed: "a ~~gone~~ b",
    blocks: ["paragraph"],
    markdown: "a ~~gone~~ b\n",
    probes: [["strike", true]],
  },
  // ── CJK boundaries (the CJK-aware regex family's reason to exist) ─────
  {
    name: "bold fires directly after CJK text (no space needed)",
    typed: "中文**粗体**后",
    blocks: ["paragraph"],
    markdown: "中文**粗体**后\n",
    probes: [["bold", true]],
  },
  {
    name: "italic fires between CJK characters",
    typed: "前*斜体*后",
    blocks: ["paragraph"],
    markdown: "前*斜体*后\n",
    probes: [["italic", true]],
  },
  // ── Pinned negatives: syntax WITHOUT an input rule stays literal ──────
  {
    name: "==highlight== has NO input rule — stays literal (escaped on serialize)",
    typed: "a ==mark== b",
    blocks: ["paragraph"],
    markdown: "a \\==mark\\== b\n",
    probes: [["highlight", false]],
  },
  {
    name: "task syntax '- [ ] ' has NO input rule — plain bullet, literal brackets",
    typed: "- [ ] todo",
    blocks: ["bulletList", "paragraph"],
    markdown: "- \\[ ] todo\n\n",
  },
  {
    name: "checked task syntax '- [x] ' has NO input rule either",
    typed: "- [x] done",
    blocks: ["bulletList", "paragraph"],
    markdown: "- \\[x] done\n\n",
  },
  {
    name: "underscore inside snake_case does NOT italicize (Unicode boundary guard)",
    typed: "a snake_case_name b",
    blocks: ["paragraph"],
    markdown: "a snake_case_name b\n",
    probes: [["italic", false]],
  },
  {
    name: "no emphasis rule fires inside an inline code span",
    typed: "`x **y** z",
    blocks: ["paragraph"],
    markdown: "`x **y** z`\n",
    probes: [["bold", false], ["code", true]],
  },
];

describe("typed-input matrix (production stack)", () => {
  it.each(CASES)("$name", (c) => {
    withTypingSession({ markdown: "" }, (s) => {
      const initial = s.markdown();
      s.type(c.typed);

      expect(topBlocks(s), "top-level blocks").toEqual(c.blocks);
      expect(s.markdown(), "serialized markdown").toBe(c.markdown);
      for (const [name, present] of c.probes ?? []) {
        expect(markNames(s).has(name), `mark probe ${name}`).toBe(present);
      }

      // History undo inverts to the initial document within a bounded number
      // of steps — grouping varies per rule, the bound is the invariant.
      let steps = 0;
      while (s.markdown() !== initial && steps < 25 && s.undo()) steps += 1;
      expect(s.markdown(), `history undo (after ${steps} steps)`).toBe(initial);
    });
  });

  it.each(CASES.filter((c) => c.backspaceReverts !== undefined))(
    "$name — one Backspace immediately after the rule restores the literal text",
    (c) => {
      withTypingSession({ markdown: "" }, (s) => {
        s.type(c.typed);
        s.press("Backspace");
        expect(s.markdown()).toBe(c.backspaceReverts);
      });
    },
  );

  it("Backspace right after '# ' reverts the heading (measured: block reverts, literal text does NOT return)", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("# ");
      expect(topBlocks(s)[0]).toBe("heading");
      const handled = s.press("Backspace");
      // Pinned reality: the keydown is claimed and the empty heading becomes
      // a paragraph again — but the typed "# " is NOT restored (this is the
      // keymap's block revert, not a text-restoring undoInputRule). History
      // undo remains the way back to the literal text.
      expect(handled, "keydown claimed").toBe(true);
      expect(topBlocks(s)[0]).toBe("paragraph");
      expect(s.editor.state.doc.textContent).toBe("");
    });
  });

  it("no rule fires inside a code block (typed via the backtick machine)", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("```"); // triple backtick → code block (WI-1.1's fixed path)
      expect(topBlocks(s)).toContain("codeBlock");
      s.type("# not a heading **not bold**");
      expect(topBlocks(s).filter((b) => b === "heading")).toEqual([]);
      expect(markNames(s).has("bold")).toBe(false);
    });
  });

  it("caret lands inside the heading after '# '", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("# ");
      expect(s.editor.state.selection.$from.parent.type.name).toBe("heading");
    });
  });

  it("caret continues after the closing bold marker", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("**b** after");
      expect(s.editor.state.doc.textContent).toBe("b after");
      expect(s.markdown()).toBe("**b** after\n");
    });
  });

  it("autoPair type-over consumes a typed closing bracket (keydown path)", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("(x)");
      // "(" auto-paired to "()"; the typed ")" was consumed by type-over —
      // NOT inserted twice. This runs through the keydown leg (keyHandler),
      // which handleTextInput alone would miss.
      expect(s.editor.state.doc.textContent).toBe("(x)");
    });
  });

  it("Enter in a list continues the list; Enter on an empty item exits it", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("- one");
      s.press("Enter");
      s.type("two");
      expect(s.markdown()).toBe("- one\n- two\n\n");
      s.press("Enter");
      s.press("Enter"); // empty item → exit list
      const blocks = topBlocks(s);
      expect(blocks[0]).toBe("bulletList");
      expect(blocks).toContain("paragraph");
      // Pinned reality: exiting leaves the exit paragraph PLUS the standing
      // trailing paragraph — two blank lines in the serialization.
      expect(s.markdown()).toBe("- one\n- two\n\n\n\n");
    });
  });
});
