/**
 * MCP Bridge — CJK Formatting Handlers
 *
 * Purpose: CJK-specific operations — punctuation conversion, spacing fixes,
 *   and full CJK formatting using user settings.
 *
 * @module hooks/mcpBridge/cjkHandlers
 */

import { respond, getEditor } from "./utils";
import { requireString } from "./validateArgs";
import { addCJKEnglishSpacing } from "@/lib/cjkFormatter/rules";
import { formatMarkdown } from "@/lib/cjkFormatter";
import { useSettingsStore } from "@/stores/settingsStore";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import {
  getSerializeOptions,
  shouldPreserveTwoSpaceBreaks,
} from "@/plugins/toolbarActions/wysiwygAdapterUtils";

/* ──── Punctuation maps ──── */

export const HALF_TO_FULL: Record<string, string> = {
  ",": "\uFF0C",
  ".": "\u3002",
  "!": "\uFF01",
  "?": "\uFF1F",
  ";": "\uFF1B",
  ":": "\uFF1A",
  "(": "\uFF08",
  ")": "\uFF09",
};

export const FULL_TO_HALF: Record<string, string> = Object.fromEntries(
  Object.entries(HALF_TO_FULL).map(([k, v]) => [v, k])
);

/* ──── Handlers ──── */

/**
 * Handle vmark.cjkPunctuationConvert request.
 * Converts CJK punctuation between halfwidth and fullwidth forms.
 */
export async function handleCjkPunctuationConvert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const direction = requireString(args, "direction");
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

    const action = requireString(args, "action");
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
      result = addCJKEnglishSpacing(selectedText);
    } else {
      const cjkPattern =
        "[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]";
      result = selectedText
        .replace(new RegExp(`(${cjkPattern}) ([A-Za-z0-9])`, "g"), "$1$2")
        .replace(new RegExp(`([A-Za-z0-9]) (${cjkPattern})`, "g"), "$1$2");
    }

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

/**
 * Handle vmark.cjkFormat request.
 * Applies full CJK formatting using user settings via markdown roundtrip.
 * Scope "document" formats the entire document; "selection" formats selected text.
 *
 * Both paths use serialize→format→parse roundtrip to preserve inline marks
 * (bold, links, math, etc.) and respect preserveTwoSpaceHardBreaks setting.
 */
export async function handleCjkFormat(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const scope =
      args.scope === undefined ? "document" : requireString(args, "scope");
    if (scope !== "selection" && scope !== "document") {
      throw new Error('scope must be "selection" or "document"');
    }

    const config = useSettingsStore.getState().cjkFormatting;
    const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
    const serializeOpts = getSerializeOptions();

    if (scope === "document") {
      const content = serializeMarkdown(
        editor.schema,
        editor.state.doc,
        serializeOpts
      );
      const formatted = formatMarkdown(content, config, {
        preserveTwoSpaceHardBreaks,
      });

      if (formatted !== content) {
        const newDoc = parseMarkdown(editor.schema, formatted, {
          preserveLineBreaks: serializeOpts.preserveLineBreaks,
        });
        const view = editor.view;
        const tr = view.state.tr
          .replaceWith(0, view.state.doc.content.size, newDoc.content)
          .setMeta("addToHistory", true);
        view.dispatch(tr);
      }
    } else {
      // Selection path: serialize selection to markdown, format, parse back.
      // This preserves inline marks (bold, links, math) unlike textBetween().
      const { from, to, empty } = editor.state.selection;
      if (empty) throw new Error("No text selected");

      const slice = editor.state.doc.slice(from, to);
      const wrapperDoc = editor.schema.topNodeType.create(null, slice.content);
      const selectedMd = serializeMarkdown(
        editor.schema,
        wrapperDoc,
        serializeOpts
      );
      const formatted = formatMarkdown(selectedMd, config, {
        preserveTwoSpaceHardBreaks,
      });

      if (formatted !== selectedMd) {
        const newDoc = parseMarkdown(editor.schema, formatted, {
          preserveLineBreaks: serializeOpts.preserveLineBreaks,
        });
        const view = editor.view;
        const tr = view.state.tr
          .replaceWith(from, to, newDoc.content)
          .setMeta("addToHistory", true);
        view.dispatch(tr);
      }
    }

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
