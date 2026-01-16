import { describe, it, expect } from "vitest";
import { markdownToHtml } from "./exportUtils";

const stripWhitespace = (value: string) => value.replace(/\s+/g, " ");

describe("markdownToHtml", () => {
  it("renders details blocks", () => {
    const html = markdownToHtml("<details><summary>Click</summary>\n\nHello\n</details>");
    const normalized = stripWhitespace(html);
    expect(normalized).toContain("<details");
    expect(normalized).toContain("<summary>Click</summary>");
    expect(normalized).toContain("Hello");
  });

  it("renders alert blocks", () => {
    const html = markdownToHtml("> [!NOTE]\n> hello");
    expect(html).toContain("markdown-alert");
    expect(html).toContain("markdown-alert-note");
  });

  it("renders wiki links", () => {
    const html = markdownToHtml("[[Page|Alias]]");
    expect(html).toContain("wiki-link");
    expect(html).toContain(">Alias<");
  });

  it("renders mermaid blocks", () => {
    const html = markdownToHtml("```mermaid\nflowchart LR\nA-->B\n```");
    expect(html).toContain("class=\"mermaid\"");
  });

  it("renders inline math", () => {
    const html = markdownToHtml("Formula: $E=mc^2$");
    expect(html).toContain("math-inline");
    expect(html).toContain("E=mc^2");
  });
});
