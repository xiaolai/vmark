/**
 * The projection's own contract.
 *
 * `parserConformance.test.ts` uses this to compare real trees; these pin the
 * behaviours that decide whether that comparison is meaningful — chiefly that
 * an UNKNOWN node type keeps its fields rather than projecting to `{}`. A new
 * extension must be visible to the gate, not silently equal to everything.
 *
 * @coordinates-with utils/markdownPipeline/conformance/semanticProjection.ts
 * @module utils/markdownPipeline/conformance/semanticProjection.test
 */
import { describe, it, expect } from "vitest";
import { visit } from "unist-util-visit";
import "../dialect";
import { createMarkdownProcessor } from "../parser/processorFactory";
import { FIXTURES } from "./fixtures";
import {
  project,
  diff,
  listedTypes,
  NEVER_SEMANTIC,
  DELIBERATELY_DROPPED,
  type RawNode,
} from "./semanticProjection";

const node = (n: RawNode) => n;

describe("project keeps what is semantic", () => {
  it("keeps a known type's listed keys and drops the rest", () => {
    const p = project(node({
      type: "heading", depth: 2, position: { start: 0 }, data: { hName: "h2" },
    }));
    expect(p.attributes).toEqual({ depth: 2 });
  });

  it("keeps EVERY non-plumbing field of an unknown type", () => {
    // The safe direction: a new extension is compared, not ignored.
    const p = project(node({ type: "brandNew", flavour: "x", count: 2, data: {} }));
    expect(p.attributes).toEqual({ count: 2, flavour: "x" });
  });

  it("omits undefined values so absent and unset compare equal", () => {
    expect(project(node({ type: "listItem", checked: undefined })).attributes).toEqual({});
  });

  it("never reorders children", () => {
    const p = project(node({
      type: "root",
      children: [{ type: "b" }, { type: "a" }],
    }));
    expect(p.children.map((c) => c.type)).toEqual(["b", "a"]);
  });

  it("treats a missing children array as empty", () => {
    expect(project(node({ type: "text", value: "x" })).children).toEqual([]);
  });
});

describe("diff reports every way two trees differ", () => {
  it("finds nothing for identical trees", () => {
    const t = () => project(node({ type: "root", children: [{ type: "text", value: "a" }] }));
    expect(diff(t(), t())).toEqual([]);
  });

  it("reports a type mismatch and STOPS descending", () => {
    // Comparing the attributes and children of unrelated shapes buries the one
    // difference that matters under noise.
    const a = project(node({ type: "heading", depth: 1, children: [{ type: "text", value: "x" }] }));
    const b = project(node({ type: "paragraph", children: [{ type: "text", value: "y" }] }));
    const d = diff(a, b);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("type");
  });

  it("reports an attribute difference with both values", () => {
    const d = diff(
      project(node({ type: "heading", depth: 1 })),
      project(node({ type: "heading", depth: 2 })),
    );
    expect(d).toEqual([
      expect.objectContaining({ kind: "attribute", detail: "depth", documentValue: 1, sourcePositionValue: 2 }),
    ]);
  });

  it("reports an attribute present on only one side", () => {
    const d = diff(
      project(node({ type: "listItem", checked: true })),
      project(node({ type: "listItem" })),
    );
    expect(d).toEqual([expect.objectContaining({ kind: "attribute", detail: "checked" })]);
  });

  it("reports a child-count difference AND still compares the shared children", () => {
    const d = diff(
      project(node({ type: "root", children: [{ type: "text", value: "a" }, { type: "text", value: "b" }] })),
      project(node({ type: "root", children: [{ type: "text", value: "z" }] })),
    );
    expect(d.map((x) => x.kind)).toEqual(["child-count", "attribute"]);
  });

  it("reports a missing side rather than throwing", () => {
    expect(diff(project(node({ type: "root" })), undefined)[0]).toEqual(
      expect.objectContaining({ kind: "missing", detail: "absent in source-position" }),
    );
    expect(diff(undefined, project(node({ type: "root" })))[0]).toEqual(
      expect.objectContaining({ kind: "missing", detail: "absent in document" }),
    );
  });

  it("paths name the exact child that differs", () => {
    const d = diff(
      project(node({ type: "root", children: [{ type: "text", value: "a" }, { type: "text", value: "b" }] })),
      project(node({ type: "root", children: [{ type: "text", value: "a" }, { type: "text", value: "B" }] })),
    );
    expect(d[0].path).toBe("root.children[1]");
  });
});

describe("the allow-list does not silently drop a real field", () => {
  it("keeps every field the parser emits on a LISTED type", () => {
    // For an UNLISTED type the projection keeps everything, so a drop can only
    // happen on a type someone enumerated — and then it is invisible: two
    // genuinely different trees compare equal and the conformance gate passes
    // having proved nothing. `math.meta` was dropped exactly this way.
    const listed = new Set(listedTypes());
    const dropped = new Map<string, Set<string>>();

    for (const fixture of FIXTURES) {
      const processor = createMarkdownProcessor();
      const tree = processor.runSync(processor.parse(fixture.markdown)) as unknown as RawNode;
      visit(tree as never, (node: RawNode) => {
        if (!listed.has(node.type)) return;
        const projected = project(node);
        for (const key of Object.keys(node)) {
          if (NEVER_SEMANTIC.has(key) || node[key] === undefined) continue;
          if (key in projected.attributes) continue;
          if (DELIBERATELY_DROPPED.get(node.type)?.has(key)) continue;
          if (!dropped.has(node.type)) dropped.set(node.type, new Set());
          dropped.get(node.type)!.add(key);
        }
      });
    }

    expect([...dropped].map(([t, keys]) => `${t}: ${[...keys].join(",")}`)).toEqual([]);
  });

  it("every deliberate drop names a type the allow-list actually lists", () => {
    const listed = new Set(listedTypes());
    expect([...DELIBERATELY_DROPPED.keys()].filter((t) => !listed.has(t))).toEqual([]);
  });
});
