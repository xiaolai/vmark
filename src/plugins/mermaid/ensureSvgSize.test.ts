// @vitest-environment node
/**
 * #1215 / #1200 — mermaid SVGs must carry a resolvable height.
 *
 * Mermaid's `calculateSvgSizeAttrs` emits `width="100%"` + `style="max-width:
 * Npx"` and NO height whenever `useMaxWidth` is on, which is its default for
 * every diagram type. VMark styles that SVG `height: auto` inside a
 * `display:flex; align-items:center` container, so it is a non-stretched flex
 * item with a percentage width and no intrinsic height — a shape some engines
 * resolve to zero, leaving an invisible diagram inside a `min-height:100px`
 * grey container. No error, no log, just a grey box.
 */
import { describe, it, expect } from "vitest";
import { ensureSvgSize } from "./ensureSvgSize";

const mermaidLike = (attrs: string) =>
  `<svg id="m1" ${attrs} viewBox="0 0 340 130" xmlns="http://www.w3.org/2000/svg"><g/></svg>`;

describe("ensureSvgSize", () => {
  it("adds an aspect-ratio derived from the viewBox", () => {
    const out = ensureSvgSize(mermaidLike('width="100%" style="max-width: 340px;"'));
    expect(out).toContain("aspect-ratio: 340 / 130");
  });

  it("leaves width alone, so diagrams still fill the editor as before", () => {
    // Replacing width with pixels would shrink every working diagram — a
    // visible change for everyone to fix a bug only some see.
    const out = ensureSvgSize(mermaidLike('width="100%" style="max-width: 340px;"'));
    expect(out).toContain('width="100%"');
    expect(out).toContain("max-width: 340px");
  });

  it("appends to an existing style without dropping it", () => {
    const out = ensureSvgSize(mermaidLike('width="100%" style="max-width: 340px;"'));
    expect(out).toMatch(/style="max-width: 340px; aspect-ratio: 340 \/ 130;"/);
  });

  it("adds a style attribute when the SVG has none", () => {
    const out = ensureSvgSize(`<svg width="100%" viewBox="0 0 10 20"><g/></svg>`);
    expect(out).toContain('style="aspect-ratio: 10 / 20;"');
  });

  it("handles a style without a trailing semicolon", () => {
    const out = ensureSvgSize(`<svg width="100%" style="color: red" viewBox="0 0 4 2"/>`);
    expect(out).toContain("color: red; aspect-ratio: 4 / 2;");
  });

  it("leaves an SVG that already has a height alone", () => {
    const svg = mermaidLike('width="340" height="130"');
    expect(ensureSvgSize(svg)).toBe(svg);
  });

  it("is idempotent — a second pass adds nothing", () => {
    const once = ensureSvgSize(mermaidLike('width="100%" style="max-width: 340px;"'));
    expect(ensureSvgSize(once)).toBe(once);
  });

  it("handles a fractional viewBox", () => {
    const out = ensureSvgSize(`<svg width="100%" viewBox="0 0 1166 1654.5"><g/></svg>`);
    expect(out).toContain("aspect-ratio: 1166 / 1654.5");
  });

  it("handles a viewBox with a non-zero origin", () => {
    const out = ensureSvgSize(`<svg width="100%" viewBox="-8 -8 200 90"><g/></svg>`);
    expect(out).toContain("aspect-ratio: 200 / 90");
  });

  it("tolerates comma-separated viewBox values", () => {
    const out = ensureSvgSize(`<svg width="100%" viewBox="0,0,50,25"><g/></svg>`);
    expect(out).toContain("aspect-ratio: 50 / 25");
  });

  it("leaves an SVG with no viewBox untouched — nothing to derive from", () => {
    const svg = `<svg width="100%"><g/></svg>`;
    expect(ensureSvgSize(svg)).toBe(svg);
  });

  it("ignores a degenerate viewBox rather than pinning the diagram flat", () => {
    const svg = `<svg width="100%" viewBox="0 0 0 0"><g/></svg>`;
    expect(ensureSvgSize(svg)).toBe(svg);
  });

  it("only rewrites the ROOT svg, not a nested icon", () => {
    const out = ensureSvgSize(
      `<svg width="100%" viewBox="0 0 10 20"><svg width="100%" viewBox="0 0 4 4"/></svg>`,
    );
    expect(out).toContain("aspect-ratio: 10 / 20");
    expect(out).not.toContain("aspect-ratio: 4 / 4");
  });

  it("returns non-SVG input unchanged", () => {
    expect(ensureSvgSize("")).toBe("");
    expect(ensureSvgSize("<div>nope</div>")).toBe("<div>nope</div>");
  });
});
