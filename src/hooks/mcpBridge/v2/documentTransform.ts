/**
 * Document transform helpers for the MCP `document.transform` action
 * (extracted from document.ts to keep it under its size baseline).
 *
 * Purpose: deterministic CJK content rewrites — format (full pipeline),
 * spacing (CJK↔Latin), punctuation (half→full width adjacent to CJK).
 *
 * @coordinates-with document.ts — handleDocumentTransform dispatches here
 * @coordinates-with lib/cjkFormatter — formatMarkdown for cjk-format
 * @module hooks/mcpBridge/v2/documentTransform
 */
import { useSettingsStore } from "@/stores/settingsStore";
import { formatMarkdown } from "@/lib/cjkFormatter";
import { shouldPreserveTwoSpaceBreaks } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { HALF_TO_FULL } from "./cjkMaps";

export const TRANSFORM_KINDS = [
  "cjk-format",
  "cjk-spacing",
  "cjk-punctuation",
] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

export function isTransformKind(value: unknown): value is TransformKind {
  return (
    typeof value === "string" &&
    (TRANSFORM_KINDS as readonly string[]).includes(value)
  );
}

const CJK_RE = "[一-鿿぀-ゟ゠-ヿ가-힯]";

export function applyTransform(kind: TransformKind, content: string): string {
  switch (kind) {
    case "cjk-format": {
      const config = useSettingsStore.getState().cjkFormatting;
      const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
      return formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });
    }
    case "cjk-spacing": {
      // Add spacing between CJK and Latin/digits in both directions.
      // Idempotent — only adds a single space; never doubles.
      return content
        .replace(new RegExp(`(${CJK_RE})([A-Za-z0-9])`, "g"), "$1 $2")
        .replace(new RegExp(`([A-Za-z0-9])(${CJK_RE})`, "g"), "$1 $2");
    }
    case "cjk-punctuation": {
      // Convert ASCII punctuation adjacent to CJK characters to its
      // full-width form. Pure ASCII contexts are left alone.
      let result = content;
      for (const [half, full] of Object.entries(HALF_TO_FULL)) {
        const escaped = half.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result
          .replace(new RegExp(`(${CJK_RE})${escaped}`, "g"), `$1${full}`)
          .replace(new RegExp(`${escaped}(${CJK_RE})`, "g"), `${full}$1`);
      }
      return result;
    }
  }
}
