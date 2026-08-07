// @vitest-environment node
/**
 * Tests for footnotePopup/tiptapNodes — footnote_reference and footnote_definition
 * node extension definitions.
 */

import { describe, it, expect } from "vitest";

import { footnoteReferenceExtension, footnoteDefinitionExtension } from "./tiptapNodes";

describe("footnoteReferenceExtension", () => {
  it("has name 'footnote_reference'", () => {
    expect(footnoteReferenceExtension.name).toBe("footnote_reference");
  });

  it("is an inline node", () => {
    expect(footnoteReferenceExtension.config.inline).toBe(true);
  });

  it("is an atom node", () => {
    expect(footnoteReferenceExtension.config.atom).toBe(true);
  });

  it("is selectable", () => {
    expect(footnoteReferenceExtension.config.selectable).toBe(true);
  });

  it("belongs to inline group", () => {
    expect(footnoteReferenceExtension.config.group).toBe("inline");
  });

  it("defines label attribute with default '1'", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    expect(attrs.label).toBeDefined();
    expect(attrs.label.default).toBe("1");
  });

  it("parseHTML targets sup with data-type footnote_reference", () => {
    const rules = footnoteReferenceExtension.config.parseHTML!.call({} as never);
    expect(rules).toHaveLength(1);
    expect(rules[0].tag).toBe('sup[data-type="footnote_reference"]');
  });

  it("renders as sup element with correct attributes", () => {
    const result = footnoteReferenceExtension.config.renderHTML!.call(
      {} as never,
      {
        node: { attrs: { label: "3" } },
        HTMLAttributes: {},
      } as never
    );
    expect(result[0]).toBe("sup");
    expect(result[1]["data-type"]).toBe("footnote_reference");
    expect(result[1]["data-label"]).toBe("3");
    expect(result[1].id).toBe("fnref-3");
    expect(result[1].contenteditable).toBe("false");
    // Link child
    expect(result[2][0]).toBe("a");
    expect(result[2][1].href).toBe("#fndef-3");
    expect(result[2][2]).toBe("3");
  });

  it("handles null label gracefully", () => {
    const result = footnoteReferenceExtension.config.renderHTML!.call(
      {} as never,
      {
        node: { attrs: { label: null } },
        HTMLAttributes: {},
      } as never
    );
    expect(result[1]["data-label"]).toBe("");
    expect(result[1].id).toBe("fnref-");
  });

  it("label parseHTML extracts from data-label attribute", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    const mockElement = { getAttribute: (attr: string) => attr === "data-label" ? "5" : null };
    expect(attrs.label.parseHTML(mockElement)).toBe("5");
  });

  it("label parseHTML defaults to '1' when no data-label", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    const mockElement = { getAttribute: () => null };
    expect(attrs.label.parseHTML(mockElement)).toBe("1");
  });

  it("label renderHTML returns data-label", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: "7" });
    expect(result).toEqual({ "data-label": "7" });
  });

  it("label renderHTML handles null label", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: null });
    expect(result).toEqual({ "data-label": "" });
  });

  it("label renderHTML handles undefined label", () => {
    const attrs = footnoteReferenceExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: undefined });
    expect(result).toEqual({ "data-label": "" });
  });
});

describe("footnoteDefinitionExtension", () => {
  it("has name 'footnote_definition'", () => {
    expect(footnoteDefinitionExtension.name).toBe("footnote_definition");
  });

  it("is a block node", () => {
    expect(footnoteDefinitionExtension.config.group).toBe("block");
  });

  it("contains paragraph content", () => {
    expect(footnoteDefinitionExtension.config.content).toBe("paragraph");
  });

  it("is a defining node", () => {
    expect(footnoteDefinitionExtension.config.defining).toBe(true);
  });

  it("defines label attribute with default '1'", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    expect(attrs.label.default).toBe("1");
  });

  it("parseHTML targets dl with data-type footnote_definition", () => {
    const rules = footnoteDefinitionExtension.config.parseHTML!.call({} as never);
    expect(rules).toHaveLength(1);
    expect(rules[0].tag).toBe('dl[data-type="footnote_definition"]');
  });

  it("renders as dl element with correct attributes", () => {
    const result = footnoteDefinitionExtension.config.renderHTML!.call(
      {} as never,
      {
        node: { attrs: { label: "2" } },
        HTMLAttributes: {},
      } as never
    );
    expect(result[0]).toBe("dl");
    expect(result[1]["data-type"]).toBe("footnote_definition");
    expect(result[1]["data-label"]).toBe("2");
    expect(result[1].id).toBe("fndef-2");
    // dt child
    expect(result[2][0]).toBe("dt");
    expect(result[2][1]["data-label"]).toBe("2");
    expect(result[2][2]).toBe("2");
    // dd child (content hole)
    expect(result[3][0]).toBe("dd");
    expect(result[3][2]).toBe(0);
  });

  it("handles null label gracefully", () => {
    const result = footnoteDefinitionExtension.config.renderHTML!.call(
      {} as never,
      {
        node: { attrs: { label: null } },
        HTMLAttributes: {},
      } as never
    );
    expect(result[1]["data-label"]).toBe("");
    expect(result[1].id).toBe("fndef-");
  });

  it("label parseHTML extracts from data-label attribute", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    const mockElement = { getAttribute: (attr: string) => attr === "data-label" ? "9" : null };
    expect(attrs.label.parseHTML(mockElement)).toBe("9");
  });

  it("label parseHTML defaults to '1' when no data-label", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    const mockElement = { getAttribute: () => null };
    expect(attrs.label.parseHTML(mockElement)).toBe("1");
  });

  it("label renderHTML returns data-label string", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: "4" });
    expect(result).toEqual({ "data-label": "4" });
  });

  it("label renderHTML handles null label", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: null });
    expect(result).toEqual({ "data-label": "" });
  });

  it("label renderHTML handles undefined label", () => {
    const attrs = footnoteDefinitionExtension.config.addAttributes!.call({} as never);
    const result = attrs.label.renderHTML({ label: undefined });
    expect(result).toEqual({ "data-label": "" });
  });
});
