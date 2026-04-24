/**
 * Bench Helpers
 *
 * Shared fixture generators for VMark benchmarks. Lives in src/bench/ so it
 * isn't pulled into the production bundle and isn't covered by app tests.
 *
 * @module bench/helpers
 */

/**
 * Generate a synthetic markdown document of `lines` blocks with a realistic
 * mix of headings, paragraphs, lists, blockquotes, and code blocks.
 *
 * Approximate sizing (UTF-8 bytes after `join("\n\n")`):
 *   - 500   blocks ≈  10 KB
 *   - 2_500 blocks ≈  50 KB
 *   - 5_000 blocks ≈ 100 KB
 *   - 8_000 blocks ≈ 160 KB
 */
export function generateMarkdown(lines: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i % 30 === 0) blocks.push("```\ncode block\n```");
    else if (i % 20 === 0) blocks.push(`## Heading ${i}`);
    else if (i % 15 === 0) blocks.push(`> Blockquote line ${i}`);
    else if (i % 10 === 0) blocks.push(`- List item ${i}`);
    else blocks.push(`Paragraph ${i} with some text content that represents a typical line.`);
  }
  return blocks.join("\n\n");
}

/**
 * Generate a markdown document that contains many fenced code blocks of the
 * given language. Used to stress the `codePreview` plugin's fast-path: the
 * E1 fix only avoids the O(blocks) doc walk when changes don't intersect any
 * code-block range, so a doc with many such blocks magnifies the win.
 *
 * Layout: every `blockEvery` paragraphs is replaced with a 3-line fenced
 * block in the requested language. The remaining paragraphs are plain text
 * that receives the simulated keystrokes (so the change is OUTSIDE the code
 * blocks — exactly the fast-path scenario).
 */
export function generateMarkdownWithCodeBlocks(
  lines: number,
  blockEvery: number,
  language = "mermaid",
): string {
  const blocks: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i > 0 && i % blockEvery === 0) {
      blocks.push("```" + language + "\ngraph TD\nA --> B\n```");
    } else {
      blocks.push(`Paragraph ${i} with some text content that represents a typical line.`);
    }
  }
  return blocks.join("\n\n");
}
