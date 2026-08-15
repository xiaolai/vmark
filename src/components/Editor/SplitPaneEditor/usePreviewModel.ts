/**
 * One coherent snapshot for the preview pane.
 *
 * Purpose: decide WHICH renderer the preview uses, WHAT content it draws, and
 * WHICH diagnostics annotate it — all from the same revision of the document.
 *
 * Those three were derived separately in `SplitPaneEditor`, and once preview
 * content became deferred (#1273) they could disagree: schema detection and
 * diagnostics read the current content while the renderer was handed the
 * deferred one, so a schema-changing edit could mount the new schema's renderer
 * with the previous document and a third revision's diagnostics. Deriving them
 * together is the fix; keeping them in one place is what stops it recurring.
 *
 * Two values come out deliberately, not one:
 *
 * | Field | Revision | For |
 * |---|---|---|
 * | `content` | deferred | rendering — may lag a frame under fast typing |
 * | `liveContent` | current | ACTIONS — executing what the user can no longer see is a bug |
 *
 * The source pane's own gutter diagnostics are NOT this hook's business: they
 * track the caret and come live from `SourcePane`.
 *
 * @module components/Editor/SplitPaneEditor/usePreviewModel
 */

import { useDeferredValue, useMemo } from "react";
import type {
  FormatConfig,
  PreviewRenderer,
  ValidationDiagnostic,
} from "@/lib/formats/types";

export interface PreviewModelArgs {
  formatConfig: FormatConfig;
  /** The document's current content, straight from the store. */
  content: string;
  filePath: string | null;
  /** Explicit per-tab schema pick, outranking the detector. */
  activeSchemaId: string | null;
}

export interface PreviewModel {
  Preview: PreviewRenderer | undefined;
  hasPreview: boolean;
  /** Deferred — what the renderer draws. */
  content: string;
  /** Current — what an action must operate on. */
  liveContent: string;
  /** Computed from `content`, so they describe the same revision. */
  diagnostics: ValidationDiagnostic[];
}

export function usePreviewModel({
  formatConfig,
  content,
  filePath,
  activeSchemaId,
}: PreviewModelArgs): PreviewModel {
  // Rendering a preview is the expensive half of the pane — the HTML adapter
  // re-sanitizes through DOMPurify and rebuilds its iframe, at a cost that
  // scales with document size. Deferring lets React drop intermediate
  // keystrokes rather than render every one. `useDeferredValue` rather than a
  // debounce, matching OutlineView and StatusBarCounts: no timer to pick a
  // constant for, and no fixed lag on a small document.
  const previewContent = useDeferredValue(content);

  const Preview = useMemo(() => {
    const renderers = formatConfig.schemaRenderers;
    if (renderers) {
      const chosen = activeSchemaId ? renderers[activeSchemaId] : undefined;
      if (chosen) return chosen;
      const detector = formatConfig.schemaDetector;
      if (detector) {
        try {
          const schemaId = detector(filePath ?? "", previewContent);
          if (schemaId && renderers[schemaId]) return renderers[schemaId];
        } catch {
          /* detector errors fall through to the generic preview */
        }
      }
    }
    return formatConfig.genericPreview;
  }, [activeSchemaId, previewContent, filePath, formatConfig]);

  const diagnostics = useMemo(() => {
    // Runs during render with no SourcePane to sandbox it, so a buggy
    // validator must not take the preview surface down with it.
    try {
      return formatConfig.validator?.(previewContent, filePath ?? undefined) ?? [];
    } catch {
      return [];
    }
  }, [formatConfig, previewContent, filePath]);

  return {
    Preview,
    hasPreview: Boolean(Preview),
    content: previewContent,
    liveContent: content,
    diagnostics,
  };
}
