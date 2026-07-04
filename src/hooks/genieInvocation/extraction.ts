/**
 * Genie Content Extraction & Template Filling
 *
 * Purpose: Pure(ish) helpers for the genie invocation pipeline — pull the
 *   scoped content out of the active editor (document/selection/block),
 *   attach surrounding context, and fill the genie prompt template.
 *   Extracted verbatim from useGenieInvocation.ts (module split).
 *
 * @coordinates-with hooks/useGenieInvocation.ts — sole consumer
 * @coordinates-with services/editor/sourcePeek.ts — block/selection range expansion
 * @module hooks/genieInvocation/extraction
 */

import type { GenieScope } from "@/types/aiGenies";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { getExpandedSourcePeekRange, serializeSourcePeekRange } from "@/services/editor/sourcePeek";
import { extractSurroundingContext } from "@/services/editor/extractContext";
import { serializeMarkdown } from "@/utils/markdownPipeline";

export interface ExtractionResult {
  text: string;
  from: number;
  to: number;
  /** True when the range covers the whole document (document scope). */
  wholeDoc?: boolean;
  contextBefore?: string;
  contextAfter?: string;
}

export function extractContent(scope: GenieScope, contextRadius = 0): ExtractionResult | null {
  const editor = useEditorStore.getState().tiptap.editor;
  const sourceMode = useUIStore.getState().sourceMode;

  /* v8 ignore start -- callers guard against source mode; defensive only */
  if (sourceMode) {
    // Per ADR-009: content lives per-document in documentStore.
    const activeTabId = useTabStore.getState().activeTabId.main;
    const doc = activeTabId ? useDocumentStore.getState().documents[activeTabId] : null;
    const content = doc?.content ?? "";
    return { text: content, from: 0, to: content.length, wholeDoc: true };
  }
  /* v8 ignore stop */

  if (!editor) return null;

  const { state } = editor;
  const { doc, selection } = state;

  let result: ExtractionResult | null;

  /* v8 ignore next -- @preserve reason: switch branch for some scope values not exercised in unit tests */
  switch (scope) {
    case "selection": {
      if (!selection.empty) {
        // Explicit selection — serialize selected range as markdown
        const range = { from: selection.from, to: selection.to };
        const text = serializeSourcePeekRange(state, range);
        result = { text, from: range.from, to: range.to };
      } else /* v8 ignore next -- @preserve reason: empty-selection expansion tested but v8 marks else keyword uncovered */ {
        // No selection — expand to compound block (whole list, blockquote, etc.)
        const range = getExpandedSourcePeekRange(state);
        const text = serializeSourcePeekRange(state, range);
        result = { text, from: range.from, to: range.to };
      }
      break;
    }

    case "block": {
      // Expand to compound block — whole list, table, blockquote
      const range = getExpandedSourcePeekRange(state);
      const text = serializeSourcePeekRange(state, range);
      result = { text, from: range.from, to: range.to };
      break;
    }

    case "document": {
      const text = serializeMarkdown(state.schema, doc);
      // Document scope — no context needed (content IS the document)
      return { text, from: 0, to: doc.content.size, wholeDoc: true };
    }

    /* v8 ignore start -- defensive: all valid scopes handled above */
    default:
      return null;
    /* v8 ignore stop */
  }

  // Attach surrounding context for non-document scopes
  if (result && contextRadius > 0) {
    const ctx = extractSurroundingContext(
      state,
      { from: result.from, to: result.to },
      contextRadius
    );
    result.contextBefore = ctx.before;
    result.contextAfter = ctx.after;
  }

  return result;
}

export function formatContext(before: string, after: string): string {
  const parts: string[] = [];
  if (before) {
    parts.push(`[Before]\n${before}`);
  }
  if (after) {
    parts.push(`[After]\n${after}`);
  }
  return parts.join("\n\n");
}

export function fillTemplate(template: string, content: string, context?: string): string {
  let result = template.replace(/\{\{\s*content\s*\}\}/g, content);
  if (context !== undefined) {
    result = result.replace(/\{\{\s*context\s*\}\}/g, context);
  }
  // Safety net: strip any {{context}} missed above (e.g., context undefined)
  result = result.replace(/\{\{\s*context\s*\}\}/g, "");
  return result;
}
