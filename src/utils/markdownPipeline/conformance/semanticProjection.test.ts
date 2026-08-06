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
  listedTypes,
  NEVER_SEMANTIC,
  DELIBERATELY_DROPPED,
  type RawNode,
} from "./semanticProjection";
import {
  diff,
} from "./projectionDiff";

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

  it("reports a type mismatch and KEEPS descending", () => {
    // Stopping here buried every descendant difference beneath a node whose
    // type diverged — and a type divergence can be DECLARED, so a subtree
    // delta suppressed real changes underneath it. On the one fixture that
    // exercises this, a text-value difference was hidden exactly that way.
    const a = project(node({ type: "heading", depth: 1, children: [{ type: "text", value: "x" }] }));
    const b = project(node({ type: "paragraph", children: [{ type: "text", value: "y" }] }));
    const d = diff(a, b);
    expect(d.map((x) => x.kind)).toEqual(["type", "attribute"]);
  });

  it("skips ATTRIBUTES on a type mismatch — unrelated shapes have unrelated fields", () => {
    const a = project(node({ type: "heading", depth: 1 }));
    const b = project(node({ type: "code", value: "x", lang: "js" }));
    expect(diff(a, b).map((x) => x.kind)).toEqual(["type"]);
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

  it("reports a child-count difference AND describes the extra children", () => {
    // Walking only the shorter side reported a count and nothing about WHAT
    // the extra nodes were.
    const d = diff(
      project(node({ type: "root", children: [{ type: "text", value: "a" }, { type: "text", value: "b" }] })),
      project(node({ type: "root", children: [{ type: "text", value: "z" }] })),
    );
    expect(d.map((x) => x.kind)).toEqual(["child-count", "attribute", "missing"]);
  });

  it("both sides absent is not a difference", () => {
    expect(diff(undefined, undefined)).toEqual([]);
  });

  it("compares object attributes by VALUE, not key insertion order", () => {
    // JSON.stringify made two equivalent objects read as divergent — a false
    // positive in a gate whose credibility rests on its findings being real.
    const a = project(node({ type: "table", align: ["left", "right"] }));
    const b = project(node({ type: "table", align: ["left", "right"] }));
    expect(diff(a, b)).toEqual([]);
  });

  it("survives a node type that collides with an Object prototype member", () => {
    expect(() => project(node({ type: "constructor", value: "x" }))).not.toThrow();
    expect(() => project(node({ type: "__proto__", value: "x" }))).not.toThrow();
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

describe("sameValue refuses to bless what it has not compared", () => {
  const a = (v: unknown) => project(node({ type: "table", align: v }));

  it("compares arrays element by element", () => {
    expect(diff(a(["left"]), a(["left"]))).toEqual([]);
    expect(diff(a(["left"]), a(["right"]))).toHaveLength(1);
    expect(diff(a(["left"]), a(["left", "right"]))).toHaveLength(1);
  });

  it("does NOT treat a hole as equal to a value", () => {
    // `Array.every` skips holes, so [ , 1] read as equal to [0, 1].
    const sparse: unknown[] = [];
    sparse[1] = "x";
    expect(diff(a(sparse), a([undefined, "x"]))).toEqual([]);
    expect(diff(a(sparse), a(["y", "x"]))).toHaveLength(1);
  });

  it("compares nested objects by value, whatever the key order", () => {
    expect(diff(a({ x: 1, y: 2 }), a({ y: 2, x: 1 }))).toEqual([]);
    expect(diff(a({ x: 1 }), a({ x: 2 }))).toHaveLength(1);
    expect(diff(a({ x: 1 }), a({ x: 1, y: 2 }))).toHaveLength(1);
  });

  it("distinguishes two different Dates", () => {
    // A key-by-key walk finds no enumerable keys on a Date and called them
    // equal — silently blessing a difference it never looked at.
    expect(diff(a(new Date(0)), a(new Date(1)))).toHaveLength(1);
    expect(diff(a(new Date(5)), a(new Date(5)))).toEqual([]);
  });

  it("distinguishes two different RegExps", () => {
    expect(diff(a(/x/g), a(/y/g))).toHaveLength(1);
    expect(diff(a(/x/g), a(/x/g))).toEqual([]);
  });

  it("reports an exotic type as different rather than assuming equality", () => {
    // Map and Set carry their contents outside enumerable keys. Unverifiable
    // means "different", not "fine".
    expect(diff(a(new Map([["k", 1]])), a(new Map([["k", 1]])))).toHaveLength(1);
  });

  it("mismatched shapes are different, not compared field-by-field", () => {
    expect(diff(a(["x"]), a({ 0: "x" }))).toHaveLength(1);
    expect(diff(a(new Date(0)), a({}))).toHaveLength(1);
  });

  it("a cycle is reported as unequal rather than throwing", () => {
    const cyc: Record<string, unknown> = { name: "c" };
    cyc.self = cyc;
    expect(() => diff(a(cyc), a(cyc))).not.toThrow();
  });

  it("null and undefined are not each other, nor equal to an object", () => {
    expect(diff(a(null), a(undefined))).toHaveLength(1);
    expect(diff(a(null), a({}))).toHaveLength(1);
  });
});
