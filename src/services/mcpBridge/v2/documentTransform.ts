/**
 * Document transform helpers for the MCP `document.transform` action
 * (extracted from document.ts to keep it under its size baseline).
 *
 * Purpose: deterministic CJK content rewrites — format (full pipeline),
 * spacing (CJK↔Latin), punctuation (half→full width adjacent to CJK).
 *
 * @coordinates-with document.ts — handleDocumentTransform dispatches here
 * @coordinates-with lib/cjkFormatter — formatMarkdown for cjk-format
 * @module services/mcpBridge/v2/documentTransform
 */
import { useSettingsStore } from "@/stores/settingsStore";
import { shouldPreserveTwoSpaceBreaks } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { formatMarkdownChecked } from "@/lib/cjkFormatter";
import type { CJKFormattingSettings } from "@/lib/cjkFormatter/types";
import { findProtectedRegions } from "@/lib/cjkFormatter/markdownParser";
import {
  extractFormattableSegments,
  reconstructText,
} from "@/lib/cjkFormatter/segments";
import { HALF_TO_FULL } from "./cjkMaps";

/**
 * Run `rewrite` over the formattable parts of `content` only.
 *
 * The narrow transforms used to run their regexes over the WHOLE document
 * (WI-CJKF4.3), so an AI assistant calling `cjk-spacing` or `cjk-punctuation`
 * rewrote fenced code, inline code, YAML frontmatter and link URLs — the same
 * corruption class as the Source-mode selection defect, reached through the
 * tool surface instead of the keyboard. `cjk-format` was never affected: it
 * goes through `formatMarkdown`, which has always done this.
 */
function overFormattableSegments(
  content: string,
  rewrite: (segment: string) => string
): string {
  const regions = findProtectedRegions(content);
  const segments = extractFormattableSegments(content, regions).map((segment) => ({
    ...segment,
    text: rewrite(segment.text),
  }));
  return reconstructText(content, segments, regions);
}

export const TRANSFORM_KINDS = [
  "cjk-format",
  "cjk-spacing",
  "cjk-punctuation",
] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

/** Everything `applyTransform` needs from the app, passed in rather than read. */
export interface TransformSettings {
  cjkFormatting: CJKFormattingSettings;
  preserveTwoSpaceHardBreaks: boolean;
}

/**
 * Read the app's current settings for a transform.
 *
 * Separate from `applyTransform` on purpose: the transform stays a pure
 * string→string function that a test can call without mocking the settings
 * store, and the store reads live in one place that a handler calls once.
 */
export function currentTransformSettings(): TransformSettings {
  return {
    cjkFormatting: useSettingsStore.getState().cjkFormatting,
    preserveTwoSpaceHardBreaks: shouldPreserveTwoSpaceBreaks(),
  };
}

export function isTransformKind(value: unknown): value is TransformKind {
  return (
    typeof value === "string" &&
    (TRANSFORM_KINDS as readonly string[]).includes(value)
  );
}

const CJK_RE = "[一-鿿぀-ゟ゠-ヿ가-힯]";

/**
 * Apply a transform to `content`.
 *
 * The CJK config and the hard-break convention are PARAMETERS, not store
 * reads. This used to call `useSettingsStore.getState()` and
 * `shouldPreserveTwoSpaceBreaks()` itself, which made a pure string→string
 * function depend on two singletons and forced every test of it to mock the
 * app's settings store — mocking app STATE rather than a boundary. The caller
 * already holds an app context; it reads the settings and passes them in.
 */
export function applyTransform(
  kind: TransformKind,
  content: string,
  settings: TransformSettings
): string {
  switch (kind) {
    case "cjk-format": {
      const { text, refused } = formatMarkdownChecked(content, settings.cjkFormatting, {
        preserveTwoSpaceHardBreaks: settings.preserveTwoSpaceHardBreaks,
      });
      // A refusal must not look like "nothing needed changing" (WI-CJKF6.2).
      // Both return the input; only one of them is a defect the caller should
      // hear about. `wrapHandler` turns this into a failed response.
      if (refused) throw new Error("cjk-format refused: the result did not match the input");
      return text;
    }
    case "cjk-spacing": {
      // Add spacing between CJK and Latin/digits in both directions.
      // Idempotent — only adds a single space; never doubles.
      return overFormattableSegments(content, (segment) =>
        segment
          .replace(new RegExp(`(${CJK_RE})([A-Za-z0-9])`, "g"), "$1 $2")
          .replace(new RegExp(`([A-Za-z0-9])(${CJK_RE})`, "g"), "$1 $2")
      );
    }
    case "cjk-punctuation": {
      // Convert ASCII punctuation adjacent to CJK characters to its
      // full-width form. Pure ASCII contexts are left alone.
      return overFormattableSegments(content, (segment) => {
        let result = segment;
        for (const [half, full] of Object.entries(HALF_TO_FULL)) {
          const escaped = half.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          result = result
            .replace(new RegExp(`(${CJK_RE})${escaped}`, "g"), `$1${full}`)
            .replace(new RegExp(`${escaped}(${CJK_RE})`, "g"), `${full}$1`);
        }
        return result;
      });
    }
  }
}
