/**
 * E01 — noUndefinedRefs
 *
 * Purpose: Flag reference-style links/images that have no matching definition.
 * Uses source-text regex to find reference patterns, and MDAST to find definitions.
 * This hybrid approach is necessary because remark does not parse
 * [text][unknown-ref] as a linkReference node when no definition exists —
 * it falls back to literal text per CommonMark spec.
 *
 * CommonMark label normalization: lowercase, collapse whitespace, trim.
 */

import { visit } from "unist-util-visit";
import type { Root, Definition } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { normalizeLabel } from "./labelUtils";

/**
 * Matches all reference forms (hoisted to module scope so it isn't recompiled
 * per line — reset `.lastIndex` before each line's scan):
 *   Full:      [text][label]  — g1 = "[text]", g3 = "[label]", g4 = "label"
 *   Collapsed: [text][]       — g1 = "[text]", g3 = "[]",      g4 = ""
 *   Shortcut:  [text]         — g1 = "[text]", g3 = undefined
 * Also matches image variants: ![alt][label], ![alt][], ![alt].
 */
const REF_PATTERN = /(!?\[([^\]\\]|\\.)*?\])(\[([^\]]*?)\])?/g;

export function noUndefinedRefs(
  _source: string,
  mdast: Root,
  { lines, lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  // Collect all definition labels from MDAST (reliable — definitions always parse)
  const definedLabels = new Set<string>();
  visit(mdast, "definition", (node: Definition) => {
    const raw = node.label ?? node.identifier ?? "";
    definedLabels.add(normalizeLabel(raw));
  });

  // Scan source text for reference-style links: [text][label] and ![alt][label]
  // Also handle collapsed refs: [text][] and ![alt][]
  // We skip references inside code spans and fenced code blocks.
  let inFencedBlock = false;
  let fenceChar = "";
  let fenceLen = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Track fenced code blocks (skip their content)
    const trimmed = lineText.replace(/\r$/, "");
    if (!inFencedBlock) {
      const openMatch = trimmed.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openMatch) {
        inFencedBlock = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue;
      }
    } else {
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(trimmed)) {
        inFencedBlock = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }

    // Skip definition lines: `[label]: url` — not a reference usage
    if (/^ {0,3}\[[^\]]+\]:[ \t]/.test(trimmed)) continue;

    // Strip inline code spans before scanning for refs
    const strippedLine = lineText.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));

    // Hoisted `REF_PATTERN` (module scope) — reset its lastIndex per line since
    // the global-flag regex is reused across lines (O6 / WI-2.5).
    REF_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = REF_PATTERN.exec(strippedLine)) !== null) {
      const fullBracket = match[1]; // e.g. "[text]" or "![alt]"
      const hasBracket = match[3] !== undefined; // second [...] present
      const bracketContent = match[4]; // content of second [...]; "" for collapsed

      let label: string;

      if (!hasBracket) {
        // Shortcut reference [label]: only a reference when a definition exists.
        // If no definition, CommonMark treats it as literal text — skip it.
        const textContent = fullBracket.replace(/^!?\[/, "").replace(/\]$/, "");
        if (!definedLabels.has(normalizeLabel(textContent))) continue;
        // Definition found → it IS a valid shortcut reference, no error.
        continue;
      } else if (bracketContent === "") {
        // Collapsed reference [text][] — link text is the label
        label = fullBracket.replace(/^!?\[/, "").replace(/\]$/, "");
      } else {
        // Full reference [text][label]
        label = bracketContent;
      }

      const normalizedLabel = normalizeLabel(label);
      if (!definedLabels.has(normalizedLabel)) {
        const fullMatch = match[0];
        const column = match.index + 1;
        // O(1) offset via the precomputed per-line start offsets (O6 / WI-2.5)
        // instead of re-scanning the source for every reference match.
        const offset = lineOffsets[lineNum - 1] + column - 1;
        const endOffset = offset + fullMatch.length;

        diagnostics.push(
          createDiagnostic({
            ruleId: "E01",
            severity: "error",
            messageKey: "lint.E01",
            messageParams: { ref: label },
            line: lineNum,
            column,
            offset,
            endOffset,
            uiHint: "exact",
          })
        );
      }
    }
  }

  return diagnostics;
}
