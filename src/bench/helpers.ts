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

/**
 * Generate a realistic terminal-output byte stream of ~`targetBytes` UTF-8
 * bytes for the PTY transport benchmark (WI-0.1, plan
 * dev-docs/plans/20260531-terminal-industrial-best.md).
 *
 * The mix mirrors what a PTY actually emits: SGR color escapes, cursor moves,
 * ASCII prose, and occasional multibyte runs (CJK + emoji). This matters
 * because the current transport's cost is byte-count-driven (every byte
 * becomes up to 4 JSON characters), and multibyte content is common in real
 * sessions (CJK locales, emoji in modern CLIs).
 */
export function generateTerminalOutput(targetBytes: number): Uint8Array {
  const enc = new TextEncoder();
  const lines = [
    "\x1b[1;32m➜\x1b[0m \x1b[1;36m~/project\x1b[0m $ pnpm build\n",
    "\x1b[2m[12:04:31]\x1b[0m \x1b[34mINFO\x1b[0m compiling module \x1b[33msrc/index.ts\x1b[0m\n",
    "  \x1b[32m✓\x1b[0m bundled 1284 modules in 842ms\n",
    "\x1b[31mERROR\x1b[0m type mismatch at line 42: expected \x1b[1mstring\x1b[0m\n",
    "  日本語のログ行 — CJK 输出 with 表意文字 中文字符 ✨🚀\n",
    "\rProgress: \x1b[42m          \x1b[0m 100%\n",
  ];
  const chunks: Uint8Array[] = [];
  let total = 0;
  let i = 0;
  while (total < targetBytes) {
    const bytes = enc.encode(lines[i % lines.length]);
    chunks.push(bytes);
    total += bytes.length;
    i++;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Encode bytes the way the *current* PTY transport does on the wire: Tauri
 * serializes a Rust `Vec<u8>` event payload as a JSON array of numbers
 * (`[27,91,...]`). Returns the JSON string so the bench can measure both the
 * size blow-up and the parse cost.
 */
export function encodeAsJsonNumberArray(bytes: Uint8Array): string {
  // Array.from then JSON.stringify mirrors serde_json's array serialization.
  return JSON.stringify(Array.from(bytes));
}
