#!/usr/bin/env node
/**
 * Check em-dash spacing in markdown files.
 * Rule: Em-dashes in English text should have spaces around them: "word — word"
 *
 * Skips:
 * - Code blocks (fenced and indented)
 * - Inline code
 * - URLs
 * - CJK text (different rules apply)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Simple recursive glob for markdown files.
 */
function findMarkdownFiles(dir, results = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common excluded directories
      if (["node_modules", "dist", ".vitepress", ".git", "target", "dev-docs"].includes(entry.name)) continue;
      findMarkdownFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "CHANGELOG.md") {
      results.push(fullPath);
    }
  }
  return results;
}

const args = process.argv.slice(2);
const files = args.length ? args : findMarkdownFiles(".");

// Em-dash character
const EM_DASH = "—";

// CJK character ranges
const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;

// Pattern: word character + em-dash + word character (no spaces)
// This catches "word—word" but not "word — word"
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track fenced code blocks
    if (line.trimStart().startsWith("```") || line.trimStart().startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip inside code blocks
    if (inCodeBlock) continue;

    // Skip indented code blocks (4+ spaces or tab at start)
    if (/^(?:    |\t)/.test(line)) continue;

    // Find em-dashes in the line
    let pos = 0;
    while ((pos = line.indexOf(EM_DASH, pos)) !== -1) {
      const before = line[pos - 1];
      const after = line[pos + 1];

      // Skip if inside inline code
      const beforeLine = line.slice(0, pos);
      const afterLine = line.slice(pos + 1);
      const backticksBefore = (beforeLine.match(/`/g) || []).length;
      if (backticksBefore % 2 === 1) {
        pos++;
        continue;
      }

      // Skip if adjacent to CJK characters (different rules)
      if ((before && CJK_RANGE.test(before)) || (after && CJK_RANGE.test(after))) {
        pos++;
        continue;
      }

      // Check for missing spaces
      const needsSpaceBefore = before && /\w/.test(before);
      const needsSpaceAfter = after && /\w/.test(after);

      if (needsSpaceBefore || needsSpaceAfter) {
        // Extract context
        const start = Math.max(0, pos - 15);
        const end = Math.min(line.length, pos + 16);
        const context = line.slice(start, end);

        violations.push({
          file,
          line: lineNum,
          col: pos + 1,
          context: context.trim(),
        });
      }

      pos++;
    }
  }
}

if (violations.length > 0) {
  console.error("Em-dash spacing violations (use spaces: word — word):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}`);
    console.error(`    Found: ...${v.context}...`);
    console.error("");
  }
  console.error(`Found ${violations.length} violation(s). Em-dashes should have spaces around them in English.`);
  process.exit(1);
}

console.log("Em-dash spacing check passed.");
