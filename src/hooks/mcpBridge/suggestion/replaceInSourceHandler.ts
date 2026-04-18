/**
 * document.replaceInSource suggestion handler.
 *
 * Serializes the document to markdown, performs a find/replace at source
 * level, then re-parses. This bypasses ProseMirror node boundaries so
 * matches can cross formatting marks. Honors `autoApproveEdits`.
 *
 * @module hooks/mcpBridge/suggestion/replaceInSourceHandler
 */

import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "../utils";
import { requireString, booleanWithDefault } from "../validateArgs";

export async function handleDocumentReplaceInSourceWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const search = requireString(args, "search");
    const replace = requireString(args, "replace");
    const replaceAll = booleanWithDefault(args, "all", false);

    if (search.length === 0) {
      throw new Error("search must be a non-empty string");
    }

    // Serialize current document to markdown
    const markdown = serializeMarkdown(editor.state.schema, editor.state.doc);

    // Try exact match first, then fall back to normalized matching.
    // Round-trip serialization can introduce subtle whitespace differences
    // (e.g. trailing spaces, line break normalization, entity encoding).
    const parts = markdown.split(search);
    let totalMatches = parts.length - 1;
    let usedNormalized = false;

    if (totalMatches === 0) {
      // Normalize: collapse runs of whitespace to single space, trim lines
      const normalize = (s: string) =>
        s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();

      const normMarkdown = normalize(markdown);
      const normSearch = normalize(search);

      if (normSearch.length > 0) {
        const normParts = normMarkdown.split(normSearch);
        totalMatches = normParts.length - 1;
        if (totalMatches > 0) {
          usedNormalized = true;
        }
      }
    }

    if (totalMatches === 0) {
      await respond({
        id,
        success: true,
        data: { count: 0, message: "No matches found" },
      });
      return;
    }

    let count = replaceAll ? totalMatches : 1;

    // Perform the replacement on the markdown string
    let newMarkdown: string;
    let actualCount: number | undefined;
    if (usedNormalized) {
      // Use regex-based replacement that tolerates whitespace differences
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Convert normalized search into a regex that allows flexible whitespace
      const flexPattern = escapeRegex(search)
        .replace(/[ \t]+/g, "[ \\t]+")
        .replace(/\\n/g, "\\n");
      const regex = new RegExp(flexPattern, replaceAll ? "g" : "");
      // Count actual regex matches to report accurate replacement count
      const regexMatches = markdown.match(new RegExp(flexPattern, "g"));
      /* v8 ignore start -- null regex match (no match found) not exercised in tests */
      const regexMatchCount = regexMatches?.length ?? 0;
      /* v8 ignore stop */
      actualCount = replaceAll ? regexMatchCount : Math.min(1, regexMatchCount);
      newMarkdown = markdown.replace(regex, replace);
      // Override count with actual regex match count (may differ from normalized split count)
      /* v8 ignore start -- actualCount always defined here; undefined guard is defensive */
      if (actualCount !== undefined) count = actualCount;
      /* v8 ignore stop */
    } else if (replaceAll) {
      newMarkdown = parts.join(replace);
    } else {
      const firstIdx = markdown.indexOf(search);
      newMarkdown =
        markdown.substring(0, firstIdx) +
        replace +
        markdown.substring(firstIdx + search.length);
    }

    // Auto-approve: parse and replace entire document
    if (isAutoApproveEnabled()) {
      const slice = createMarkdownPasteSlice(editor.state, newMarkdown);
      const tr = editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, slice.content)
        .scrollIntoView();
      editor.view.dispatch(tr);

      await respond({
        id,
        success: true,
        data: {
          count,
          message: `${count} replacement(s) applied in source (auto-approved).`,
          applied: true,
        },
      });
      return;
    }

    // Suggestion mode: create a single whole-document replacement suggestion
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      tabId: getActiveTabId(),
      type: "replace",
      from: 0,
      to: editor.state.doc.content.size,
      newContent: newMarkdown,
      originalContent: markdown,
    });

    await respond({
      id,
      success: true,
      data: {
        count,
        suggestionIds: [suggestionId],
        message: `${count} replacement(s) staged as suggestion. Awaiting user approval.`,
        applied: false,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
