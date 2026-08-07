// @vitest-environment node
/**
 * Tests for subscript and superscript mark extensions.
 */

import { describe, it, expect } from "vitest";
import { subscriptExtension, superscriptExtension } from "../tiptap";

describe("subscriptExtension", () => {
  it("has correct name", () => {
    expect(subscriptExtension.name).toBe("subscript");
  });

  it("parseHTML matches <sub> tag", () => {
    const parseRules = subscriptExtension.config.parseHTML!.call({} as never)!;
    expect(parseRules).toHaveLength(1);
    expect(parseRules[0].tag).toBe("sub");
  });

  it("renderHTML produces sub element with class", () => {
    const renderHTML = subscriptExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, { HTMLAttributes: {} } as never) as unknown as unknown[];
    expect(result[0]).toBe("sub");
    expect(result[1]).toHaveProperty("class", "md-subscript");
    expect(result[2]).toBe(0); // content hole
  });

  it("renderHTML merges existing HTML attributes", () => {
    const renderHTML = subscriptExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, {
      HTMLAttributes: { "data-custom": "value" },
    } as never) as unknown as unknown[];
    expect(result[1]).toHaveProperty("data-custom", "value");
    expect(result[1]).toHaveProperty("class", "md-subscript");
  });
});

describe("superscriptExtension", () => {
  it("has correct name", () => {
    expect(superscriptExtension.name).toBe("superscript");
  });

  it("parseHTML matches <sup> tag", () => {
    const parseRules = superscriptExtension.config.parseHTML!.call({} as never)!;
    expect(parseRules).toHaveLength(1);
    expect(parseRules[0].tag).toBe("sup");
  });

  it("renderHTML produces sup element with class", () => {
    const renderHTML = superscriptExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, { HTMLAttributes: {} } as never) as unknown as unknown[];
    expect(result[0]).toBe("sup");
    expect(result[1]).toHaveProperty("class", "md-superscript");
    expect(result[2]).toBe(0);
  });

  it("renderHTML merges existing HTML attributes", () => {
    const renderHTML = superscriptExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, {
      HTMLAttributes: { id: "fn-1" },
    } as never) as unknown as unknown[];
    expect(result[1]).toHaveProperty("id", "fn-1");
    expect(result[1]).toHaveProperty("class", "md-superscript");
  });
});
