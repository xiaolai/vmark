/**
 * Bench Helpers
 *
 * Shared fixture generators for VMark benchmarks. Lives in src/bench/ so it
 * isn't pulled into the production bundle. (Equivalence tests import these
 * generators for realistic corpora — see incrementalTextMetrics.test.ts —
 * but the generators themselves have no dedicated unit tests.)
 *
 * @module bench/helpers
 */

/**
 * Generate a synthetic markdown document of `lines` blocks with a realistic
 * mix of headings, paragraphs, lists, blockquotes, and code blocks.
 *
 * Measured sizing (UTF-8 bytes ≈ chars for this ASCII-dominant fixture):
 *   - 500    blocks ≈  31 KB
 *   - 2_500  blocks ≈ 156 KB
 *   - 8_000  blocks ≈ 500 KB
 *   - 50_000 blocks ≈ 3.2 MB
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
 * Generate a CJK-heavy markdown document of `blocks` blocks. Mirrors
 * `generateMarkdown`'s shape (headings, quotes, lists, code) but with Chinese
 * prose, so benchmarks exercise the CJK regex paths (`\p{Script=Han}`,
 * fullwidth punctuation) that dominate for 字数-counting users.
 *
 * Measured sizing: 30_000 blocks ≈ 1.9M UTF-16 code units (≈ 4 MB UTF-8).
 */
export function generateCjkMarkdown(blocks: number): string {
  const out: string[] = [];
  for (let i = 0; i < blocks; i++) {
    if (i % 30 === 0) out.push("```\n代码示例\n```");
    else if (i % 20 === 0) out.push(`## 第${i}节 标题`);
    else if (i % 15 === 0) out.push(`> 引用：这是第${i}段的引文，包含标点符号——以及破折号。`);
    else if (i % 10 === 0) out.push(`- 列表项 ${i}：中文内容`);
    else out.push(`第${i}段：这是一段典型的中文正文，混合了 English words 和标点符号，比如逗号、句号。还有一些数字 ${i} 与符号！`);
  }
  return out.join("\n\n");
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
 * ASCII prose, and occasional multibyte runs (CJK + emoji). This mattered
 * for the retired JSON-array transport (every byte became up to 4 JSON
 * characters), and multibyte content remains common in real sessions
 * (CJK locales, emoji in modern CLIs).
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
 * Encode bytes the way the *retired* JSON-array PTY transport did on the
 * wire: Tauri serialized a Rust `Vec<u8>` event payload as a JSON array of
 * numbers (`[27,91,...]`). The live transport is a binary Channel
 * (`InvokeResponseBody::Raw` → ArrayBuffer); this helper is kept solely as
 * the historical baseline for terminal.bench.ts's before/after record.
 */
export function encodeAsJsonNumberArray(bytes: Uint8Array): string {
  // Array.from then JSON.stringify mirrors serde_json's array serialization.
  return JSON.stringify(Array.from(bytes));
}
