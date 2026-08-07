// @vitest-environment node
/**
 * Tests for underline mark extension.
 */

import { describe, it, expect } from "vitest";
import { underlineExtension } from "../tiptap";

describe("underlineExtension", () => {
  it("has correct name", () => {
    expect(underlineExtension.name).toBe("underline");
  });

  it("parseHTML matches <u> tag", () => {
    const parseRules = underlineExtension.config.parseHTML!.call({} as never)!;
    expect(parseRules).toHaveLength(1);
    expect(parseRules[0].tag).toBe("u");
  });

  it("renderHTML produces u element with class", () => {
    const renderHTML = underlineExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, { HTMLAttributes: {} } as never) as unknown as unknown[];
    expect(result[0]).toBe("u");
    expect(result[1]).toHaveProperty("class", "md-underline");
    expect(result[2]).toBe(0); // content hole
  });

  it("renderHTML merges existing HTML attributes", () => {
    const renderHTML = underlineExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, {
      HTMLAttributes: { style: "color: red" },
    } as never) as unknown as unknown[];
    expect(result[1]).toHaveProperty("style", "color: red");
    expect(result[1]).toHaveProperty("class", "md-underline");
  });

  it("renderHTML preserves content hole marker", () => {
    const renderHTML = underlineExtension.config.renderHTML!;
    const result = renderHTML.call({} as never, { HTMLAttributes: {} } as never) as unknown as unknown[];
    // Last element should be 0 (content hole for marks)
    expect(result[result.length - 1]).toBe(0);
  });
});
