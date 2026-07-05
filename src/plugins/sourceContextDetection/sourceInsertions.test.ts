import { describe, it, expect } from "vitest";
import {
  buildDetailsBlock,
  buildAlertBlock,
  buildFencedBlock,
  buildMathBlock,
  buildDiagramBlock,
  buildGraphvizBlock,
  buildMarkmapBlock,
} from "./sourceInsertions";

describe("buildDetailsBlock", () => {
  it("creates details block without selection", () => {
    const result = buildDetailsBlock("");
    expect(result.text).toBe("<details>\n<summary>Details</summary>\n\n</details>");
    expect(result.cursorOffset).toBe("<details>\n<summary>Details</summary>\n".length);
  });

  it("wraps selection in details block", () => {
    const result = buildDetailsBlock("Some content");
    expect(result.text).toBe("<details>\n<summary>Details</summary>\n\nSome content\n</details>");
    expect(result.cursorOffset).toBe("<details>\n<summary>Details</summary>\n\n".length);
  });

  it("handles multiline selection", () => {
    const result = buildDetailsBlock("Line 1\nLine 2");
    expect(result.text).toBe("<details>\n<summary>Details</summary>\n\nLine 1\nLine 2\n</details>");
  });
});

describe("buildAlertBlock", () => {
  it("creates NOTE alert block", () => {
    const result = buildAlertBlock("NOTE", "");
    expect(result.text).toBe("> [!NOTE]\n> ");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("creates TIP alert block", () => {
    const result = buildAlertBlock("TIP", "");
    expect(result.text).toBe("> [!TIP]\n> ");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("creates IMPORTANT alert block", () => {
    const result = buildAlertBlock("IMPORTANT", "");
    expect(result.text).toBe("> [!IMPORTANT]\n> ");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("creates WARNING alert block", () => {
    const result = buildAlertBlock("WARNING", "");
    expect(result.text).toBe("> [!WARNING]\n> ");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("creates CAUTION alert block", () => {
    const result = buildAlertBlock("CAUTION", "");
    expect(result.text).toBe("> [!CAUTION]\n> ");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("quotes single-line selection under the alert marker (no data loss)", () => {
    const result = buildAlertBlock("NOTE", "important text");
    expect(result.text).toBe("> [!NOTE]\n> important text");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("quotes each line of a multi-line selection", () => {
    const result = buildAlertBlock("WARNING", "line one\nline two\nline three");
    expect(result.text).toBe("> [!WARNING]\n> line one\n> line two\n> line three");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("keeps blank lines inside the selection as bare quote markers", () => {
    const result = buildAlertBlock("TIP", "first\n\nsecond");
    expect(result.text).toBe("> [!TIP]\n> first\n>\n> second");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("preserves CJK selection content", () => {
    const result = buildAlertBlock("IMPORTANT", "中文内容\n第二行");
    expect(result.text).toBe("> [!IMPORTANT]\n> 中文内容\n> 第二行");
  });
});

describe("buildFencedBlock", () => {
  it("uses default content when selection is empty", () => {
    const result = buildFencedBlock("", "mermaid", "graph TD\n  A --> B");
    expect(result.text).toBe("```mermaid\ngraph TD\n  A --> B\n```");
    expect(result.cursorOffset).toBe("```mermaid\n".length);
  });

  it("wraps selection instead of default content", () => {
    const result = buildFencedBlock("my content", "dot", "digraph {}");
    expect(result.text).toBe("```dot\nmy content\n```");
    expect(result.cursorOffset).toBe("```dot\n".length);
  });

  it("handles multi-line selection", () => {
    const result = buildFencedBlock("a\nb", "markmap", "# X");
    expect(result.text).toBe("```markmap\na\nb\n```");
  });
});

describe("buildMathBlock", () => {
  it("creates empty math block without selection", () => {
    const result = buildMathBlock("");
    expect(result.text).toBe("$$\n\n$$");
    expect(result.cursorOffset).toBe("$$\n".length);
  });

  it("wraps selection in math block", () => {
    const result = buildMathBlock("x^2 + y^2 = z^2");
    expect(result.text).toBe("$$\nx^2 + y^2 = z^2\n$$");
    expect(result.cursorOffset).toBe("$$\n".length);
  });

  it("handles multiline math content", () => {
    const result = buildMathBlock("a = 1\nb = 2");
    expect(result.text).toBe("$$\na = 1\nb = 2\n$$");
  });
});

describe("buildDiagramBlock", () => {
  it("creates diagram block with default content when no selection", () => {
    const result = buildDiagramBlock("");
    expect(result.text).toContain("```mermaid\n");
    expect(result.text).toContain("\n```");
    expect(result.text).toContain("graph TD");
    expect(result.cursorOffset).toBe("```mermaid\n".length);
  });

  it("wraps selection in diagram block", () => {
    const result = buildDiagramBlock("flowchart LR\n  A --> B");
    expect(result.text).toBe("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(result.cursorOffset).toBe("```mermaid\n".length);
  });
});

describe("buildGraphvizBlock", () => {
  it("creates graphviz block with default content when no selection", () => {
    const result = buildGraphvizBlock("");
    expect(result.text).toContain("```dot\n");
    expect(result.text).toContain("\n```");
    expect(result.text).toContain("digraph");
    expect(result.cursorOffset).toBe("```dot\n".length);
  });

  it("wraps selection in graphviz block", () => {
    const result = buildGraphvizBlock("digraph { a -> b }");
    expect(result.text).toBe("```dot\ndigraph { a -> b }\n```");
    expect(result.cursorOffset).toBe("```dot\n".length);
  });
});

describe("buildMarkmapBlock", () => {
  it("creates markmap block with default content when no selection", () => {
    const result = buildMarkmapBlock("");
    expect(result.text).toContain("```markmap\n");
    expect(result.text).toContain("\n```");
    expect(result.text).toContain("# Mindmap");
    expect(result.cursorOffset).toBe("```markmap\n".length);
  });

  it("wraps selection in markmap block", () => {
    const result = buildMarkmapBlock("# My Map\n## Branch");
    expect(result.text).toBe("```markmap\n# My Map\n## Branch\n```");
    expect(result.cursorOffset).toBe("```markmap\n".length);
  });
});
