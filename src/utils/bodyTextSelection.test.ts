// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { allowBodyTextSelection, suppressBodyTextSelection } from "./bodyTextSelection";

describe("body text selection during a drag", () => {
  afterEach(() => {
    document.body.removeAttribute("style");
  });

  it("writes the prefixed property, the only one WebKit honours", () => {
    suppressBodyTextSelection();
    expect(document.body.style.getPropertyValue("-webkit-user-select")).toBe("none");
  });

  it("also writes the standard property for other engines", () => {
    suppressBodyTextSelection();
    expect(document.body.style.getPropertyValue("user-select")).toBe("none");
  });

  it("clears both properties", () => {
    suppressBodyTextSelection();
    allowBodyTextSelection();
    expect(document.body.style.getPropertyValue("-webkit-user-select")).toBe("");
    expect(document.body.style.getPropertyValue("user-select")).toBe("");
  });

  it("is safe to repeat and to clear without a prior suppress", () => {
    allowBodyTextSelection();
    suppressBodyTextSelection();
    suppressBodyTextSelection();
    allowBodyTextSelection();
    expect(document.body.getAttribute("style") ?? "").not.toContain("user-select");
  });
});
