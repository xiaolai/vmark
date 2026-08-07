// @vitest-environment node
import { layoutWorkflow } from "../layout";
import { parseWorkflow } from "../parser";

describe("layoutWorkflow", () => {
  it("returns empty arrays for empty graph", () => {
    const yaml = `
name: Empty
steps:
  - id: only
    uses: action/read-file
`;
    const graph = parseWorkflow(yaml);
    const { nodes, edges } = layoutWorkflow(graph);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  it("produces sequential layout with ascending x positions", () => {
    const yaml = `
name: Sequential
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
  - id: c
    uses: action/save-file
`;
    const graph = parseWorkflow(yaml);
    const { nodes, edges } = layoutWorkflow(graph);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);

    // Sequential: each node has greater x than the previous
    const xPositions = nodes.map((n) => n.position.x);
    expect(xPositions[0]).toBeLessThan(xPositions[1]);
    expect(xPositions[1]).toBeLessThan(xPositions[2]);
  });

  it("produces parallel layout with same x for siblings", () => {
    const yaml = `
name: Parallel
steps:
  - id: read
    uses: action/read-folder
  - id: summarize
    uses: genie/summarize
    needs: read
  - id: translate
    uses: genie/translate
    needs: read
  - id: save
    uses: action/save-files
    needs: [summarize, translate]
`;
    const graph = parseWorkflow(yaml);
    const { nodes } = layoutWorkflow(graph);

    expect(nodes).toHaveLength(4);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const sum = nodeMap.get("summarize")!;
    const trl = nodeMap.get("translate")!;

    // Parallel siblings should have same x rank, different y
    expect(sum.position.x).toBeCloseTo(trl.position.x, 0);
    expect(sum.position.y).not.toBeCloseTo(trl.position.y, 0);
  });

  it("produces fan-in edges that converge on one node", () => {
    const yaml = `
name: FanIn
steps:
  - id: read
    uses: action/read-folder
  - id: a
    uses: genie/summarize
    needs: read
  - id: b
    uses: genie/translate
    needs: read
  - id: merge
    uses: action/save-file
    needs: [a, b]
`;
    const graph = parseWorkflow(yaml);
    const { edges } = layoutWorkflow(graph);

    const mergeEdges = edges.filter((e) => e.target === "merge");
    expect(mergeEdges).toHaveLength(2);
  });

  it("nodes have non-overlapping positions", () => {
    const yaml = `
name: NoOverlap
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
  - id: c
    uses: genie/translate
  - id: d
    uses: action/save-file
`;
    const graph = parseWorkflow(yaml);
    const { nodes } = layoutWorkflow(graph);

    // No two nodes should have the same position
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const samePos =
          Math.abs(nodes[i].position.x - nodes[j].position.x) < 1 &&
          Math.abs(nodes[i].position.y - nodes[j].position.y) < 1;
        expect(samePos).toBe(false);
      }
    }
  });

  it("node data contains step metadata", () => {
    const yaml = `
name: Metadata
steps:
  - id: read
    uses: action/read-folder
`;
    const graph = parseWorkflow(yaml);
    const { nodes } = layoutWorkflow(graph);

    const node = nodes[0];
    expect(node.id).toBe("read");
    expect(node.type).toBe("workflow");
    expect(node.data.label).toBe("read");
    expect(node.data.icon).toBe("📂");
    expect(node.data.stepType).toBe("action");
    expect(node.data.stepId).toBe("read");
  });

  it("edges use smoothstep type", () => {
    const yaml = `
name: Edges
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
`;
    const graph = parseWorkflow(yaml);
    const { edges } = layoutWorkflow(graph);

    expect(edges[0].type).toBe("smoothstep");
  });
});
