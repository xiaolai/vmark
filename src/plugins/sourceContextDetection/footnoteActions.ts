/**
 * Footnote Actions for Source Mode
 *
 * Parsing and manipulation of markdown footnotes.
 * Supports:
 * - Alphanumeric labels: [^1], [^note], [^ref-1], [^my_ref]
 * - Multi-line definitions with indentation
 * - Code block awareness (ignores content in fenced/indented code)
 * - Orphan cleanup
 * - Sequential renumbering with consolidation at document end
 */

// ===========================================
// Types
// ===========================================

export interface FootnoteRef {
  label: string;
  start: number;
  end: number;
}

export interface FootnoteDef {
  label: string;
  start: number;
  end: number;
  content: string;
}

// ===========================================
// Code Block Detection
// ===========================================

interface CodeBlockRange {
  start: number;
  end: number;
}

/**
 * Find all code block ranges (fenced and indented) in the document.
 */
function findCodeBlockRanges(doc: string): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  const lines = doc.split("\n");
  let pos = 0;
  let inFencedBlock = false;
  let fenceStart = 0;
  let fenceChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = pos;
    const lineEnd = pos + line.length;

    // Check for fenced code block markers
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inFencedBlock) {
        inFencedBlock = true;
        fenceStart = lineStart;
        fenceChar = fenceMatch[1][0];
      } else if (line.startsWith(fenceChar.repeat(3))) {
        inFencedBlock = false;
        ranges.push({ start: fenceStart, end: lineEnd });
      }
    }

    // Check for indented code block (4 spaces or tab, not in list context)
    // Only if not already in a fenced block and previous line is blank or start
    if (!inFencedBlock && (line.startsWith("    ") || line.startsWith("\t"))) {
      const prevLine = i > 0 ? lines[i - 1] : "";
      if (prevLine.trim() === "" || i === 0) {
        // Find extent of indented block
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.startsWith("    ") || nextLine.startsWith("\t") || nextLine.trim() === "") {
            j++;
          } else {
            break;
          }
        }
        // Calculate block end position
        let blockEnd = lineStart;
        for (let k = i; k < j; k++) {
          blockEnd += lines[k].length + 1;
        }
        ranges.push({ start: lineStart, end: blockEnd - 1 });
      }
    }

    pos = lineEnd + 1; // +1 for newline
  }

  // Handle unclosed fenced block
  if (inFencedBlock) {
    ranges.push({ start: fenceStart, end: doc.length });
  }

  return ranges;
}

/**
 * Check if a position is inside any code block.
 */
function isInCodeBlock(pos: number, ranges: CodeBlockRange[]): boolean {
  for (const range of ranges) {
    if (pos >= range.start && pos < range.end) {
      return true;
    }
  }
  return false;
}

// ===========================================
// Parsing Functions
// ===========================================

/**
 * Parse all footnote references in the document.
 * Supports alphanumeric labels: [^1], [^note], [^ref-1]
 * Ignores references inside code blocks.
 *
 * @param doc - The document text to parse
 * @param codeRanges - Optional pre-computed code block ranges (for performance)
 */
export function parseReferences(doc: string, codeRanges?: CodeBlockRange[]): FootnoteRef[] {
  const refs: FootnoteRef[] = [];
  const ranges = codeRanges ?? findCodeBlockRanges(doc);

  // Match [^label] where label is alphanumeric with hyphens/underscores
  // Negative lookahead to exclude definitions [^label]:
  const pattern = /\[\^([a-zA-Z0-9_-]+)\](?!:)/g;
  let match;

  while ((match = pattern.exec(doc)) !== null) {
    if (!isInCodeBlock(match.index, ranges)) {
      refs.push({
        label: match[1],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return refs;
}

/**
 * Parse all footnote definitions in the document.
 * Handles multi-line definitions with indentation.
 * Ignores definitions inside code blocks.
 *
 * @param doc - The document text to parse
 * @param codeRanges - Optional pre-computed code block ranges (for performance)
 */
export function parseDefinitions(doc: string, codeRanges?: CodeBlockRange[]): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  const ranges = codeRanges ?? findCodeBlockRanges(doc);
  const lines = doc.split("\n");

  let pos = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const lineStart = pos;

    // Check for definition start: [^label]:
    const defMatch = line.match(/^\[\^([a-zA-Z0-9_-]+)\]:\s?(.*)/);

    if (defMatch && !isInCodeBlock(lineStart, ranges)) {
      const label = defMatch[1];
      let content = defMatch[2];
      let defEnd = lineStart + line.length;

      // Look for continuation lines (indented or blank)
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextLineStart = defEnd + 1;

        // Check if next line is a new definition
        if (nextLine.match(/^\[\^[a-zA-Z0-9_-]+\]:/)) {
          break;
        }

        // Check if continuation (indented with 4 spaces or tab, or blank)
        if (nextLine.startsWith("    ") || nextLine.startsWith("\t") || nextLine.trim() === "") {
          content += "\n" + nextLine;
          defEnd = nextLineStart + nextLine.length;
          j++;
        } else {
          // Non-indented, non-blank line ends the definition
          break;
        }
      }

      // Trim trailing blank lines from content
      content = content.replace(/\n+$/, "");

      defs.push({
        label,
        start: lineStart,
        end: defEnd,
        content,
      });

      // Skip to after the definition
      i = j;
      pos = defEnd + 1;
      continue;
    }

    pos = lineStart + line.length + 1;
    i++;
  }

  return defs;
}

// ===========================================
// Renumbering and Cleanup
// ===========================================

/**
 * Renumber footnotes sequentially and consolidate definitions at document end.
 *
 * - Labels are assigned based on first reference appearance order
 * - All definitions are moved to the end of the document
 * - Orphaned definitions (no reference) are removed
 * - Missing definitions (reference without definition) get empty placeholders
 *
 * Returns null if no changes needed.
 */
export function renumberFootnotes(doc: string): string | null {
  // Compute code ranges once and share between parsing functions
  const codeRanges = findCodeBlockRanges(doc);

  const refs = parseReferences(doc, codeRanges);
  if (refs.length === 0) return null;

  const defs = parseDefinitions(doc, codeRanges);

  // Build label map: old label → new sequential number
  const labelMap = new Map<string, string>();
  const seenLabels: string[] = [];

  for (const ref of refs) {
    if (!labelMap.has(ref.label)) {
      const newLabel = String(seenLabels.length + 1);
      labelMap.set(ref.label, newLabel);
      seenLabels.push(ref.label);
    }
  }

  // Check if renumbering is needed
  let needsChange = false;

  // Check if labels need renumbering
  for (const [oldLabel, newLabel] of labelMap) {
    if (oldLabel !== newLabel) {
      needsChange = true;
      break;
    }
  }

  // Check if definitions need to be moved/consolidated
  if (!needsChange) {
    // Check if there are orphaned definitions
    const refLabels = new Set(refs.map((r) => r.label));
    for (const def of defs) {
      if (!refLabels.has(def.label)) {
        needsChange = true;
        break;
      }
    }
  }

  // Check if any reference is missing a definition
  if (!needsChange) {
    const defLabels = new Set(defs.map((d) => d.label));
    for (const ref of refs) {
      if (!defLabels.has(ref.label)) {
        needsChange = true;
        break;
      }
    }
  }

  // Check if definitions are not at the end or not in order
  if (!needsChange && defs.length > 0) {
    const lastDefEnd = Math.max(...defs.map((d) => d.end));
    const contentAfterDefs = doc.slice(lastDefEnd).trim();
    if (contentAfterDefs.length > 0) {
      needsChange = true;
    }
  }

  if (!needsChange) return null;

  // Build definition content map
  const defContentMap = new Map<string, string>();
  for (const def of defs) {
    defContentMap.set(def.label, def.content);
  }

  // Build the new document

  // 1. Calculate position adjustments from definition removals
  // We need to track how much each position shifts after removing definitions
  const sortedDefs = [...defs].sort((a, b) => a.start - b.start);
  const removals: Array<{ start: number; length: number }> = [];

  for (const def of sortedDefs) {
    // Calculate end position including trailing newlines
    let endPos = def.end;
    while (endPos < doc.length && doc[endPos] === "\n") {
      endPos++;
    }
    // But keep at least one newline if there's content after
    if (endPos > def.end && endPos < doc.length) {
      endPos--;
    }
    removals.push({ start: def.start, length: endPos - def.start });
  }

  // Adjust a position to account for all removed text ranges.
  // Preconditions:
  //   - `removals` is sorted by start position (ascending)
  //   - Removal ranges are non-overlapping
  // Returns -1 if pos falls inside a removed range (error case).
  function adjustPosition(pos: number): number {
    let adjustment = 0;
    for (const removal of removals) {
      if (pos > removal.start) {
        if (pos >= removal.start + removal.length) {
          // Position is after this removal - subtract the removed length
          adjustment += removal.length;
        } else {
          // Position is inside a removal (shouldn't happen for refs outside defs)
          return -1;
        }
      }
    }
    return pos - adjustment;
  }

  // 2. Remove definitions from document (in reverse order to preserve positions)
  let contentWithoutDefs = doc;
  const reverseSortedDefs = [...defs].sort((a, b) => b.start - a.start);
  for (const def of reverseSortedDefs) {
    let endPos = def.end;
    while (endPos < contentWithoutDefs.length && contentWithoutDefs[endPos] === "\n") {
      endPos++;
    }
    if (endPos > def.end && endPos < contentWithoutDefs.length) {
      endPos--;
    }
    contentWithoutDefs = contentWithoutDefs.slice(0, def.start) + contentWithoutDefs.slice(endPos);
  }

  // 3. Replace references with new labels (in reverse order of adjusted positions)
  // First, compute adjusted positions and sort by them
  const refsWithAdjusted = refs.map((ref) => ({
    ...ref,
    adjustedStart: adjustPosition(ref.start),
  }));
  const sortedRefs = refsWithAdjusted
    .filter((r) => r.adjustedStart >= 0)
    .sort((a, b) => b.adjustedStart - a.adjustedStart);

  for (const ref of sortedRefs) {
    const newLabel = labelMap.get(ref.label);
    if (newLabel && newLabel !== ref.label) {
      const oldLen = `[^${ref.label}]`.length;
      contentWithoutDefs =
        contentWithoutDefs.slice(0, ref.adjustedStart) +
        `[^${newLabel}]` +
        contentWithoutDefs.slice(ref.adjustedStart + oldLen);
    }
  }

  // 4. Trim trailing whitespace from content
  contentWithoutDefs = contentWithoutDefs.trimEnd();

  // 5. Build definitions section
  const definitionLines: string[] = [];
  for (let i = 0; i < seenLabels.length; i++) {
    const oldLabel = seenLabels[i];
    const newLabel = String(i + 1);
    const content = defContentMap.get(oldLabel) ?? "";
    definitionLines.push(`[^${newLabel}]: ${content}`);
  }

  // 6. Combine content and definitions
  const result = contentWithoutDefs + "\n\n" + definitionLines.join("\n");

  return result;
}

/**
 * Remove orphaned definitions (definitions without corresponding references).
 * Returns null if no orphans found.
 */
export function cleanupOrphanedDefinitions(doc: string): string | null {
  if (!doc) return null;

  const refs = parseReferences(doc);
  const defs = parseDefinitions(doc);

  if (defs.length === 0) return null;

  const refLabels = new Set(refs.map((r) => r.label));
  const orphanDefs = defs.filter((d) => !refLabels.has(d.label));

  if (orphanDefs.length === 0) return null;

  // Remove orphaned definitions in reverse order
  let result = doc;
  const sortedOrphans = [...orphanDefs].sort((a, b) => b.start - a.start);

  for (const def of sortedOrphans) {
    // Also remove trailing newlines
    let endPos = def.end;
    while (endPos < result.length && result[endPos] === "\n") {
      endPos++;
    }
    result = result.slice(0, def.start) + result.slice(endPos);
  }

  // Trim trailing whitespace
  result = result.trimEnd();

  return result;
}
