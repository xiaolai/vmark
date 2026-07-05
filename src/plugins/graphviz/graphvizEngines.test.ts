/**
 * Layout-engine tests for the Graphviz plugin — REAL WASM, no mocks.
 *
 * Empirically pins the engine-selection contract: Graphviz natively honors
 * the `layout` graph attribute in the DOT source (e.g. `layout=neato`),
 * overriding the `engine` render option. Engine choice therefore lives in
 * the document source — no selection UI needed — and travels to any other
 * Graphviz tool.
 *
 * These tests load the actual @viz-js/viz WASM build, so they prove the
 * behavior rather than assuming it.
 */

import { describe, it, expect } from "vitest";
import { renderGraphviz } from "./plugin";

/** A small graph whose node positions differ visibly between engines. */
function chainGraph(layoutAttr?: string): string {
  const layout = layoutAttr ? `  layout=${layoutAttr}\n` : "";
  return `digraph G {\n${layout}  a -> b\n  b -> c\n  c -> a\n}`;
}

/** Extract node center coordinates from rendered SVG (ellipse cx/cy pairs). */
function nodePositions(svg: string): string[] {
  return [...svg.matchAll(/<ellipse[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)].map(
    (m) => `${m[1]},${m[2]}`,
  );
}

describe("graphviz layout engines (real WASM)", () => {
  it("renders with the default dot engine", async () => {
    const svg = await renderGraphviz(chainGraph());
    expect(svg).toBeTruthy();
    expect(nodePositions(svg!).length).toBe(3);
  });

  it("honors layout=neato in the source (positions differ from dot)", async () => {
    const dotSvg = await renderGraphviz(chainGraph());
    const neatoSvg = await renderGraphviz(chainGraph("neato"));

    expect(dotSvg).toBeTruthy();
    expect(neatoSvg).toBeTruthy();
    expect(nodePositions(neatoSvg!).length).toBe(3);
    // Node coordinates must differ — dot is layered, neato is force-directed.
    expect(nodePositions(neatoSvg!)).not.toEqual(nodePositions(dotSvg!));
  });

  it("honors layout=circo in the source (positions differ from dot)", async () => {
    const dotSvg = await renderGraphviz(chainGraph());
    const circoSvg = await renderGraphviz(chainGraph("circo"));

    expect(circoSvg).toBeTruthy();
    expect(nodePositions(circoSvg!).length).toBe(3);
    expect(nodePositions(circoSvg!)).not.toEqual(nodePositions(dotSvg!));
  });

  it.each(["fdp", "sfdp", "twopi", "osage", "patchwork"])(
    "renders successfully with layout=%s",
    async (engine) => {
      // patchwork/osage are cluster/treemap engines — plain nodes still render.
      const svg = await renderGraphviz(chainGraph(engine));
      expect(svg).toBeTruthy();
    },
  );

  it("returns null (render error passthrough) for an unknown layout value", async () => {
    const svg = await renderGraphviz(chainGraph("not-an-engine"));
    expect(svg).toBeNull();
  });
});
