// @vitest-environment node
/**
 * Tests for tiptapInlineMath — inline math extension structure, schema, and rendering.
 */

import { describe, it, expect, vi } from "vitest";

// Mock CSS import
vi.mock("./latex.css", () => ({}));

// Mock the MathInlineNodeView
vi.mock("./MathInlineNodeView", () => ({
  MathInlineNodeView: vi.fn().mockImplementation(() => ({
    dom: document.createElement("span"),
    update: vi.fn(),
    destroy: vi.fn(),
  })),
}));

import { mathInlineExtension } from "./tiptapInlineMath";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

describe("mathInlineExtension structure", () => {
  it("has name 'math_inline'", () => {
    expect(mathInlineExtension.name).toBe("math_inline");
  });

  it("is a Node type", () => {
    expect(mathInlineExtension.type).toBe("node");
  });

  it("is configured as inline", () => {
    const config = mathInlineExtension.config;
    expect(config.inline).toBe(true);
  });

  it("is configured as atom", () => {
    const config = mathInlineExtension.config;
    expect(config.atom).toBe(true);
  });

  it("is configured as selectable", () => {
    const config = mathInlineExtension.config;
    expect(config.selectable).toBe(true);
  });

  it("belongs to the inline group", () => {
    const config = mathInlineExtension.config;
    expect(config.group).toBe("inline");
  });

  it("defines addNodeView", () => {
    expect(mathInlineExtension.config.addNodeView).toBeDefined();
  });
});

describe("mathInlineExtension attributes", () => {
  it("defines content attribute with empty default", () => {
    const addAttributes = mathInlineExtension.config.addAttributes!;
    const attrs = addAttributes.call({ name: "math_inline" } as never);
    expect(attrs).toHaveProperty("content");
    expect(attrs.content.default).toBe("");
  });

  it("parseHTML extracts textContent as content attribute", () => {
    const addAttributes = mathInlineExtension.config.addAttributes!;
    const attrs = addAttributes.call({ name: "math_inline" } as never);
    const parseHTML = attrs.content.parseHTML;

    // Simulate an element with textContent
    const mockElement = { textContent: "x^2 + y^2" } as HTMLElement;
    expect(parseHTML(mockElement)).toBe("x^2 + y^2");
  });

  it("parseHTML returns empty string for element with no content", () => {
    const addAttributes = mathInlineExtension.config.addAttributes!;
    const attrs = addAttributes.call({ name: "math_inline" } as never);
    const parseHTML = attrs.content.parseHTML;

    const mockElement = { textContent: "" } as HTMLElement;
    expect(parseHTML(mockElement)).toBe("");
  });

  it("parseHTML returns empty string for null textContent", () => {
    const addAttributes = mathInlineExtension.config.addAttributes!;
    const attrs = addAttributes.call({ name: "math_inline" } as never);
    const parseHTML = attrs.content.parseHTML;

    const mockElement = { textContent: null } as unknown as HTMLElement;
    expect(parseHTML(mockElement)).toBe("");
  });
});

describe("mathInlineExtension parseHTML", () => {
  it("parses span[data-type='math_inline'] tag", () => {
    const parseRules = mathInlineExtension.config.parseHTML!.call({
      name: "math_inline",
    } as never);
    expect(parseRules).toHaveLength(1);
    expect(parseRules[0].tag).toBe('span[data-type="math_inline"]');
  });
});

describe("mathInlineExtension renderHTML", () => {
  it("renders as span with data-type and class", () => {
    const result = mathInlineExtension.config.renderHTML!.call(
      { options: {} } as never,
      { node: { attrs: { content: "E=mc^2" } }, HTMLAttributes: {} } as never
    );
    expect(result[0]).toBe("span");
    expect(result[1]).toHaveProperty("data-type", "math_inline");
    expect(result[1]).toHaveProperty("class", "math-inline");
    expect(result[2]).toBe("E=mc^2");
  });

  it("renders empty content when no math", () => {
    const result = mathInlineExtension.config.renderHTML!.call(
      { options: {} } as never,
      { node: { attrs: { content: "" } }, HTMLAttributes: {} } as never
    );
    expect(result[2]).toBe("");
  });

  it("preserves complex LaTeX content", () => {
    const latex = "\\frac{1}{2} \\sum_{i=0}^{n} x_i";
    const result = mathInlineExtension.config.renderHTML!.call(
      { options: {} } as never,
      { node: { attrs: { content: latex } }, HTMLAttributes: {} } as never
    );
    expect(result[2]).toBe(latex);
  });
});

describe("mathInlineExtension in schema", () => {
  it("creates a valid schema with math_inline node", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    expect(schema.nodes.math_inline).toBeDefined();
  });

  it("math_inline node is inline in schema", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    const mathType = schema.nodes.math_inline;
    expect(mathType.isInline).toBe(true);
  });

  it("math_inline node is atom in schema", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    const mathType = schema.nodes.math_inline;
    expect(mathType.isAtom).toBe(true);
  });

  it("can create math_inline node with content attribute", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    const node = schema.nodes.math_inline.create({ content: "x^2" });
    expect(node.attrs.content).toBe("x^2");
  });

  it("math_inline node has default empty content", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    const node = schema.nodes.math_inline.create();
    expect(node.attrs.content).toBe("");
  });

  it("math_inline can be placed inside paragraph", () => {
    const schema = getSchema([StarterKit, mathInlineExtension]);
    const mathNode = schema.nodes.math_inline.create({ content: "y=mx+b" });
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("The formula "),
      mathNode,
      schema.text(" is linear."),
    ]);
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(1).type.name).toBe("math_inline");
  });
});
