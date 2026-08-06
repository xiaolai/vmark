/**
 * Purpose: The shared CommonMark code-fence line tracker.
 *
 * Extracted so `hasAmbiguousListUnderline` (remarkPlugins.ts) and any
 * future line scanners share ONE fence-state implementation and cannot
 * drift apart on closer/CRLF rules. (The math source guards consult a
 * probe parse via mathProbe.ts instead; their fail-closed sweep scans
 * lines but takes opacity from a math-disabled probe, not from here.)
 *
 * @coordinates-with ./remarkPlugins.ts — consumer
 * @module utils/markdownPipeline/parser/opaqueRegions
 */

/** A code fence line (backticks or tildes, CommonMark indent rule). */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BLANK_REST = /^[ \t]*\r?$/;

/**
 * Line-by-line CommonMark fence state. `feed(line)` returns true when
 * the line is code (a fence delimiter or inside an open fence). A
 * closer must repeat the OPENER's character at least the opener's
 * length and carry nothing but trailing whitespace. A backtick opener
 * whose info string contains a backtick is prose, not a fence.
 */
export function createCodeFenceTracker() {
  let fence: { char: string; size: number } | null = null;
  return {
    feed(line: string): boolean {
      const run = CODE_FENCE.exec(line);
      if (fence) {
        const closes =
          run !== null &&
          run[1][0] === fence.char &&
          run[1].length >= fence.size &&
          BLANK_REST.test(line.slice(run[0].length));
        if (closes) fence = null;
        return true;
      }
      if (run) {
        if (run[1][0] === "`" && line.slice(run[0].length).includes("`")) {
          return false; // CommonMark: backtick info strings ban backticks
        }
        fence = { char: run[1][0], size: run[1].length };
        return true;
      }
      return false;
    },
  };
}
