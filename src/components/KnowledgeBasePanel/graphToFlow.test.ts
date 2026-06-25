// H5 — KB graph → xyflow conversion + layout.
import { describe, it, expect } from "vitest";
import { graphToFlow, type KbGraph } from "./graphToFlow";

const graph: KbGraph = {
  nodes: [
    { id: "A.md", type: "doc", label: "A", title: "Note A" },
    { id: "B.md", type: "doc", label: "B" },
    { id: "#tag", type: "tag", label: "#tag" },
    { id: "[[Ghost]]", type: "doc", label: "[[Ghost]]", unresolved: true },
  ],
  edges: [
    { from: "A.md", to: "B.md", kind: "wikiLink" },
    { from: "A.md", to: "#tag", kind: "tag" },
    { from: "A.md", to: "[[Ghost]]", kind: "wikiLink", unresolved: true },
    { from: "A.md", to: "missing.md", kind: "link" }, // dangling → dropped
  ],
};

describe("graphToFlow", () => {
  it("maps every node and assigns positions", () => {
    const flow = graphToFlow(graph);
    expect(flow.nodes).toHaveLength(4);
    for (const n of flow.nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
    }
  });

  it("uses the title as the label when present, else the label", () => {
    const flow = graphToFlow(graph);
    expect(flow.nodes.find((n) => n.id === "A.md")?.data.label).toBe("Note A");
    expect(flow.nodes.find((n) => n.id === "B.md")?.data.label).toBe("B");
  });

  it("tags + unresolved nodes get distinguishing classes", () => {
    const flow = graphToFlow(graph);
    expect(flow.nodes.find((n) => n.id === "#tag")?.className).toContain("kb-graph-node--tag");
    expect(flow.nodes.find((n) => n.id === "[[Ghost]]")?.className).toContain(
      "kb-graph-node--unresolved"
    );
  });

  it("drops edges whose endpoints are not nodes", () => {
    const flow = graphToFlow(graph);
    // 4 edges in, but the missing.md link is dropped → 3 edges.
    expect(flow.edges).toHaveLength(3);
    expect(flow.edges.every((e) => e.source && e.target)).toBe(true);
  });

  it("kind drives edge class; relations animate", () => {
    const flow = graphToFlow({
      nodes: [
        { id: "x", type: "doc", label: "x" },
        { id: "y", type: "doc", label: "y" },
      ],
      edges: [{ from: "x", to: "y", kind: "relation", relationKey: "up" }],
    });
    expect(flow.edges[0].className).toContain("kb-graph-edge--relation");
    expect(flow.edges[0].animated).toBe(true);
  });
});
