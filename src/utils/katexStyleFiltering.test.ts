/**
 * KaTeX inline styles are filtered to the properties KaTeX actually emits.
 *
 * Split from `sanitize.test.ts`, which sits at its frozen size baseline.
 */
import { describe, it, expect } from "vitest";
import { sanitizeKatex } from "./sanitize";

describe("sanitizeKatex — style attribute filtering", () => {
  it("strips an external url() beacon from a style attribute", () => {
    expect(
      sanitizeKatex('<span style="background:url(https://evil.test/p.png)">x</span>'),
    ).not.toContain("evil.test");
  });

  it("strips a viewport-pinning position (overlay/clickjacking surface)", () => {
    const out = sanitizeKatex(
      '<span style="position:fixed;top:0;left:0;width:100vw;height:100vh">x</span>',
    );
    expect(out).not.toContain("fixed");
  });

  it("keeps the layout styles KaTeX genuinely emits", () => {
    const out = sanitizeKatex(
      '<span style="height:1em;vertical-align:-0.25em;margin-left:0.1em;position:relative">x</span>',
    );
    expect(out).toContain("height");
    expect(out).toContain("vertical-align");
    expect(out).toContain("position: relative");
  });
});
