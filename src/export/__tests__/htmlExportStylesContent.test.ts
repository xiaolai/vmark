import { describe, it, expect } from "vitest";
import { getContentStyles } from "../htmlExportStylesContent";

describe("getContentStyles", () => {
  const css = getContentStyles();

  it("includes @media print block with table-layout: fixed", () => {
    expect(css).toContain("@media print");
    expect(css).toContain("table-layout: fixed");
  });

  it("forces table scroll wrapper to visible overflow in print", () => {
    expect(css).toContain("overflow-x: visible");
  });

  it("enables word wrapping in printed table cells", () => {
    expect(css).toContain("overflow-wrap: break-word");
    expect(css).toContain("word-break: break-word");
  });

  it("constrains images in table cells for print", () => {
    // The print block should include max-width for images inside td
    expect(css).toMatch(/td img[^}]*max-width:\s*100%/s);
  });
});
