/**
 * Source-mode per-keystroke cost benchmark.
 *
 * Quantifies the two structural costs the Source editor pays on every edit, so
 * the "is CodeMirror a bottleneck" question is settled with numbers instead of
 * intuition:
 *
 *   Fix 1 (shipped) — whole-document vs viewport-windowed decoration scans.
 *     Compares each block finder over the full doc against a viewport-sized
 *     window. The ratio is the per-keystroke work Fix 1 removes on a large doc.
 *
 *   Fix 2 (measure-before-acting) — full-document serialization + store spread.
 *     `EditorView.updateListener` runs `doc.toString()` and an immutable store
 *     update on every keystroke (SourceEditor.tsx). These benches show what that
 *     costs at scale; debounce only if it's a meaningful slice of frame time.
 *
 * Self-contained: builds a synthetic ~20k-line markdown doc in-code, so it runs
 * anywhere with no fixture.
 *
 * Run:
 *   pnpm vitest bench src/bench/sourceDecorations.bench.ts
 */

import { bench, describe } from "vitest";
import { Text } from "@codemirror/state";
import { findAlertBlocks } from "@/plugins/codemirror/sourceAlertDecoration";
import { findMediaBlocks } from "@/plugins/codemirror/sourceMediaDecoration";
import { findDetailsBlocks } from "@/plugins/codemirror/sourceDetailsDecoration";
import { findBrLineStarts } from "@/plugins/codemirror/brHidingPlugin";

/** Build a realistic large markdown document: prose sprinkled with the block
 *  types the decoration plugins scan for (alerts, media tags, details, <br>). */
function buildDoc(totalLines: number): string[] {
  const lines: string[] = [];
  for (let i = 0; lines.length < totalLines; i++) {
    if (i % 100 === 0) {
      lines.push("> [!NOTE]", "> An informational aside about the section below.");
    } else if (i % 150 === 0) {
      lines.push("<details>", "<summary>Details</summary>", "content", "</details>");
    } else if (i % 200 === 0) {
      lines.push('<video src="clip.mp4" controls>', "</video>");
    } else if (i % 47 === 0) {
      lines.push("<br />");
    } else {
      lines.push(`Paragraph ${i}: the quick brown fox jumps over the lazy dog. `.repeat(2).trim());
    }
  }
  return lines.slice(0, totalLines);
}

const LINES = 20_000;
const lineArray = buildDoc(LINES);
const doc = Text.of(lineArray);
const content = doc.toString();
const VIEWPORT_MARGIN = 200; // matches BLOCK_SCAN_MARGIN / MAX_LOOKAHEAD
// A viewport of ~50 lines centred mid-document, plus the look-back/ahead margin.
const winStart = LINES / 2 - 25 - VIEWPORT_MARGIN;
const winEnd = LINES / 2 + 25 + VIEWPORT_MARGIN;

const opts = { iterations: 30, warmupIterations: 3 } as const;

describe(`source decorations — whole-doc vs viewport window (${LINES} lines, ${(content.length / 1024).toFixed(0)}KB)`, () => {
  // --- Fix 1: the win is (whole-doc time) / (windowed time). ---
  bench("alert scan — whole document", () => { findAlertBlocks(doc); }, opts);
  bench("alert scan — viewport window", () => { findAlertBlocks(doc, winStart, winEnd); }, opts);

  bench("media scan — whole document", () => { findMediaBlocks(doc); }, opts);
  bench("media scan — viewport window", () => { findMediaBlocks(doc, winStart, winEnd); }, opts);

  bench("details scan — whole document", () => { findDetailsBlocks(doc); }, opts);
  bench("details scan — viewport window", () => { findDetailsBlocks(doc, winStart, winEnd); }, opts);

  bench("br scan — whole document", () => { findBrLineStarts(doc); }, opts);
  bench("br scan — viewport window", () => { findBrLineStarts(doc, winStart, winEnd); }, opts);
});

describe(`source store sync — per-keystroke serialization (${LINES} lines)`, () => {
  // --- Fix 2: what SourceEditor's updateListener pays on every keystroke. ---
  bench("doc.toString() (full serialization)", () => {
    const s = doc.toString();
    if (s.length < 0) throw new Error("unreachable"); // sink
  }, opts);

  // setContent-equivalent: toString + isDirty compare + immutable store spread.
  const savedContent = content;
  const documents: Record<string, { content: string; savedContent: string; isDirty: boolean }> = {
    tab: { content, savedContent, isDirty: false },
  };
  bench("toString + isDirty compare + store spread", () => {
    const newContent = doc.toString();
    const isDirty = documents.tab.savedContent !== newContent;
    const next = { ...documents, tab: { ...documents.tab, content: newContent, isDirty } };
    if (!next.tab) throw new Error("unreachable"); // sink
  }, opts);
});
