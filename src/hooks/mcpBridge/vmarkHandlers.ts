/**
 * MCP Bridge - VMark-Specific Operation Handlers
 * Math, Mermaid, Wiki Links, CJK Formatting
 */

import { respond, getEditor } from "./utils";
import { addCJKEnglishSpacing } from "@/lib/cjkFormatter/rules";

/**
 * Handle vmark.insertMathInline request.
 * Inserts inline math at cursor position.
 */
export async function handleInsertMathInline(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const latex = args.latex as string;
    if (!latex) throw new Error("latex is required");

    // Insert math_inline node with content attribute
    editor
      .chain()
      .focus()
      .insertContent({
        type: "math_inline",
        attrs: { content: latex },
      })
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle vmark.insertMathBlock request.
 * Inserts block math (latex code block) at cursor position.
 */
export async function handleInsertMathBlock(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const latex = args.latex as string;
    if (!latex) throw new Error("latex is required");

    // Insert as a code block with latex language
    editor
      .chain()
      .focus()
      .insertContent({
        type: "codeBlock",
        attrs: { language: "latex" },
        content: [{ type: "text", text: latex }],
      })
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle vmark.insertMermaid request.
 * Inserts Mermaid diagram (mermaid code block) at cursor position.
 */
export async function handleInsertMermaid(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const code = args.code as string;
    if (!code) throw new Error("code is required");

    // Insert as a code block with mermaid language
    editor
      .chain()
      .focus()
      .insertContent({
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: code }],
      })
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle vmark.insertWikiLink request.
 * Inserts wiki-style link [[target]] or [[target|alias]] at cursor position.
 */
export async function handleInsertWikiLink(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const target = args.target as string;
    const displayText = args.displayText as string | undefined;
    if (!target) throw new Error("target is required");

    // Insert wikiLink node with value and optional alias
    editor
      .chain()
      .focus()
      .insertContent({
        type: "wikiLink",
        attrs: {
          value: target,
          alias: displayText || null,
        },
      })
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Half-width to full-width punctuation mapping
const HALF_TO_FULL: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
  "(": "（",
  ")": "）",
  "[": "【",
  "]": "】",
};

// Full-width to half-width punctuation mapping
const FULL_TO_HALF: Record<string, string> = Object.fromEntries(
  Object.entries(HALF_TO_FULL).map(([k, v]) => [v, k])
);

/**
 * Handle vmark.cjkPunctuationConvert request.
 * Converts punctuation in selection between half-width and full-width.
 */
export async function handleCjkPunctuationConvert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const direction = args.direction as string;
    if (direction !== "to-fullwidth" && direction !== "to-halfwidth") {
      throw new Error('direction must be "to-fullwidth" or "to-halfwidth"');
    }

    const { from, to, empty } = editor.state.selection;
    if (empty) {
      throw new Error("No text selected");
    }

    const selectedText = editor.state.doc.textBetween(from, to);
    const mapping = direction === "to-fullwidth" ? HALF_TO_FULL : FULL_TO_HALF;

    let converted = selectedText;
    for (const [search, replace] of Object.entries(mapping)) {
      converted = converted.split(search).join(replace);
    }

    // Replace selection with converted text
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, converted)
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle vmark.cjkSpacingFix request.
 * Adds or removes spacing between CJK and Latin characters.
 */
export async function handleCjkSpacingFix(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const action = args.action as string;
    if (action !== "add" && action !== "remove") {
      throw new Error('action must be "add" or "remove"');
    }

    const { from, to, empty } = editor.state.selection;
    if (empty) {
      throw new Error("No text selected");
    }

    const selectedText = editor.state.doc.textBetween(from, to);
    let result: string;

    if (action === "add") {
      // Use the CJK formatter's spacing function
      result = addCJKEnglishSpacing(selectedText);
    } else {
      // Remove extra spaces between CJK and Latin characters
      // Pattern: CJK + space + alphanumeric, or alphanumeric + space + CJK
      const cjkPattern = "[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]";
      result = selectedText
        .replace(new RegExp(`(${cjkPattern}) ([A-Za-z0-9])`, "g"), "$1$2")
        .replace(new RegExp(`([A-Za-z0-9]) (${cjkPattern})`, "g"), "$1$2");
    }

    // Replace selection with processed text
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, result)
      .run();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
