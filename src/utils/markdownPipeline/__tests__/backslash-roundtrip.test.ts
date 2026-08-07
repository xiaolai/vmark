// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "../parser";
import { serializeMdastToMarkdown } from "../serializer";

describe("backslash in code fences round-trip", () => {
  it("preserves single backslash in path", () => {
    const input = "```\npath\\to\\file\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-n literal", () => {
    const input = '```\necho "hello\\nworld"\n```';
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves double backslash (UNC path)", () => {
    const input = "```\n\\\\server\\share\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-dollar", () => {
    const input = "```\necho \\$HOME\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-bracket", () => {
    const input = "```\nregex \\[a-z\\]\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-star", () => {
    const input = "```\nglob \\*.txt\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-underscore", () => {
    const input = "```\nvar\\_name\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });

  it("preserves backslash-backtick", () => {
    const input = "```\necho \\`date\\`\n```";
    const mdast = parseMarkdownToMdast(input);
    const output = serializeMdastToMarkdown(mdast).trim();
    expect(output).toBe(input);
  });
});
