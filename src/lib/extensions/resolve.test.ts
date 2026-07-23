/**
 * Resolver tests — ADR-015 D1, WI-1.2.
 *
 * @module lib/extensions/resolve.test
 */
import { describe, it, expect } from "vitest";
import { resolveExtensions } from "./resolve";
import type { ExtensionGroup, VMarkExtension } from "./types";

function ext(
  id: string,
  overrides: Partial<VMarkExtension> = {},
): VMarkExtension {
  return { id, contributions: [], ...overrides };
}

function ids(group: ExtensionGroup): string[] {
  return resolveExtensions(group).ordered.map((e) => e.id);
}

describe("resolveExtensions", () => {
  describe("flattening", () => {
    it("flattens arbitrarily nested groups", () => {
      const nested = [ext("a"), [ext("b"), [ext("c"), [ext("d")]]]];
      expect(ids(nested)).toEqual(["a", "b", "c", "d"]);
    });

    it("accepts a bare extension", () => {
      expect(ids(ext("solo"))).toEqual(["solo"]);
    });

    it("accepts an empty group", () => {
      expect(ids([])).toEqual([]);
    });

    it("preserves registration order when nothing constrains it", () => {
      expect(ids([ext("z"), ext("m"), ext("a")])).toEqual(["z", "m", "a"]);
    });
  });

  describe("malformed input never throws (contract)", () => {
    it("reports a null leaf as invalid-descriptor instead of throwing", () => {
      const result = resolveExtensions([null as unknown as VMarkExtension, ext("ok")]);
      expect(result.errors.map((e) => e.code)).toContain("invalid-descriptor");
      // the valid one is still rejected as a set (errors present → empty order)
      expect(result.ordered).toEqual([]);
    });

    it("reports undefined and non-object leaves without throwing", () => {
      expect(() =>
        resolveExtensions([
          undefined as unknown as VMarkExtension,
          42 as unknown as VMarkExtension,
        ]),
      ).not.toThrow();
    });
  });

  describe("self-references", () => {
    it("rejects a self requirement", () => {
      const result = resolveExtensions([ext("a", { requires: ["a"] })]);
      expect(result.errors.map((e) => e.code)).toContain("self-reference");
    });

    it("rejects `a before a`", () => {
      const result = resolveExtensions([ext("a", { ordering: { before: ["a"] } })]);
      expect(result.errors.map((e) => e.code)).toContain("self-reference");
    });

    it("rejects `a after a`", () => {
      const result = resolveExtensions([ext("a", { ordering: { after: ["a"] } })]);
      expect(result.errors.map((e) => e.code)).toContain("self-reference");
    });
  });

  describe("duplicate ids", () => {
    it("allows the same descriptor object included twice (grouping overlap)", () => {
      const shared = ext("shared");
      const result = resolveExtensions([shared, [shared, ext("other")]]);
      expect(result.errors).toEqual([]);
      expect(result.ordered.map((e) => e.id)).toEqual(["shared", "other"]);
    });

    it("rejects two DIFFERENT descriptors claiming one id", () => {
      const result = resolveExtensions([
        ext("clash", { version: "1" }),
        ext("clash", { version: "2" }),
      ]);
      expect(result.errors.map((e) => e.code)).toContain("duplicate-id");
    });

    it("rejects an empty id", () => {
      const result = resolveExtensions([ext("")]);
      expect(result.errors.map((e) => e.code)).toContain("empty-id");
    });
  });

  describe("requirements", () => {
    it("accepts satisfied requirements", () => {
      const result = resolveExtensions([
        ext("base"),
        ext("dependent", { requires: ["base"] }),
      ]);
      expect(result.errors).toEqual([]);
    });

    it("rejects a missing requirement and names both ends", () => {
      const result = resolveExtensions([ext("dependent", { requires: ["absent"] })]);
      const error = result.errors.find((e) => e.code === "missing-requirement");
      expect(error).toBeDefined();
      expect(error?.ids).toEqual(["dependent", "absent"]);
    });

    it("orders a requirement before its dependent", () => {
      // Declared in the wrong order on purpose.
      expect(ids([ext("dependent", { requires: ["base"] }), ext("base")])).toEqual([
        "base",
        "dependent",
      ]);
    });
  });

  describe("precedence buckets", () => {
    it("orders highest → lowest regardless of registration order", () => {
      expect(
        ids([
          ext("d", { ordering: { bucket: "low" } }),
          ext("a", { ordering: { bucket: "highest" } }),
          ext("c", { ordering: { bucket: "default" } }),
          ext("b", { ordering: { bucket: "high" } }),
          ext("e", { ordering: { bucket: "lowest" } }),
        ]),
      ).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("treats a missing bucket as default", () => {
      expect(
        ids([
          ext("plain"),
          ext("late", { ordering: { bucket: "lowest" } }),
          ext("early", { ordering: { bucket: "highest" } }),
        ]),
      ).toEqual(["early", "plain", "late"]);
    });

    it("keeps registration order within one bucket", () => {
      expect(
        ids([
          ext("first", { ordering: { bucket: "high" } }),
          ext("second", { ordering: { bucket: "high" } }),
        ]),
      ).toEqual(["first", "second"]);
    });
  });

  describe("named before/after constraints", () => {
    it("honours `before`", () => {
      expect(ids([ext("a", { ordering: { before: ["b"] } }), ext("b")])).toEqual([
        "a",
        "b",
      ]);
    });

    it("honours `after`", () => {
      expect(ids([ext("a", { ordering: { after: ["b"] } }), ext("b")])).toEqual([
        "b",
        "a",
      ]);
    });

    it("lets a constraint override bucket preference", () => {
      // `late` prefers the lowest bucket but must precede `early`.
      const result = resolveExtensions([
        ext("early", { ordering: { bucket: "highest" } }),
        ext("late", { ordering: { bucket: "lowest", before: ["early"] } }),
      ]);
      expect(result.errors).toEqual([]);
      expect(result.ordered.map((e) => e.id)).toEqual(["late", "early"]);
    });

    it("rejects a reference to an unregistered id rather than ignoring it", () => {
      const result = resolveExtensions([ext("a", { ordering: { before: ["ghost"] } })]);
      const error = result.errors.find((e) => e.code === "unknown-ordering-ref");
      expect(error?.ids).toEqual(["a", "ghost"]);
    });

    it("resolves a chain transitively", () => {
      expect(
        ids([
          ext("c", { ordering: { after: ["b"] } }),
          ext("b", { ordering: { after: ["a"] } }),
          ext("a"),
        ]),
      ).toEqual(["a", "b", "c"]);
    });
  });

  describe("cycles", () => {
    it("reports a two-node cycle with the full path", () => {
      const result = resolveExtensions([
        ext("a", { ordering: { after: ["b"] } }),
        ext("b", { ordering: { after: ["a"] } }),
      ]);
      const error = result.errors.find((e) => e.code === "ordering-cycle");
      expect(error).toBeDefined();
      expect(error?.ids).toContain("a");
      expect(error?.ids).toContain("b");
    });

    it("reports a longer cycle", () => {
      const result = resolveExtensions([
        ext("a", { ordering: { after: ["c"] } }),
        ext("b", { ordering: { after: ["a"] } }),
        ext("c", { ordering: { after: ["b"] } }),
      ]);
      const error = result.errors.find((e) => e.code === "ordering-cycle");
      expect(error?.ids.length).toBeGreaterThanOrEqual(3);
    });

    it("detects a cycle formed through `requires`", () => {
      const result = resolveExtensions([
        ext("a", { requires: ["b"] }),
        ext("b", { requires: ["a"] }),
      ]);
      expect(result.errors.map((e) => e.code)).toContain("ordering-cycle");
    });

    it("does not emit a partial order when a cycle exists", () => {
      const result = resolveExtensions([
        ext("a", { ordering: { after: ["b"] } }),
        ext("b", { ordering: { after: ["a"] } }),
      ]);
      expect(result.ordered).toEqual([]);
    });

    it("names only the actual cycle members, not innocent downstream nodes", () => {
      // a↔b is the cycle; d only depends on b, so it is stuck but not IN the
      // cycle. The reported ids must be exactly {a, b}.
      const result = resolveExtensions([
        ext("a", { ordering: { after: ["b"] } }),
        ext("b", { ordering: { after: ["a"] } }),
        ext("d", { ordering: { after: ["b"] } }),
      ]);
      const error = result.errors.find((e) => e.code === "ordering-cycle");
      expect(error).toBeDefined();
      expect([...(error?.ids ?? [])].sort()).toEqual(["a", "b"]);
      expect(error?.ids).not.toContain("d");
    });

    it("finds the real cycle even when a dead-end node is searched first", () => {
      // `d` (downstream of the cycle) is registered FIRST, so it heads the stuck
      // set. A naive walk from `d` dead-ends and would report `d` as the cycle;
      // DFS back-edge detection must skip it and return {a, b}.
      const result = resolveExtensions([
        ext("d", { ordering: { after: ["b"] } }),
        ext("a", { ordering: { after: ["b"] } }),
        ext("b", { ordering: { after: ["a"] } }),
      ]);
      const error = result.errors.find((e) => e.code === "ordering-cycle");
      expect([...(error?.ids ?? [])].sort()).toEqual(["a", "b"]);
      expect(error?.ids).not.toContain("d");
    });
  });

  describe("determinism", () => {
    it("produces the same order across repeated runs", () => {
      const group = [
        ext("c", { ordering: { bucket: "low" } }),
        ext("a", { ordering: { before: ["c"] } }),
        ext("b"),
      ];
      expect(ids(group)).toEqual(ids(group));
    });

    it("is unaffected by nesting shape for the same flat sequence", () => {
      const flat = [ext("a"), ext("b"), ext("c")];
      const nested = [[ext("a")], [[ext("b")], ext("c")]];
      expect(ids(flat)).toEqual(ids(nested));
    });
  });
});
