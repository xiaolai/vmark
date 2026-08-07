// @vitest-environment node
// WI-3.4 — total-order pinning: canonical order → explicit `after` constraints.
/**
 * The property these tests protect: once every entry carries a derived `after`
 * constraint, the resolver reproduces the canonical order EXACTLY and provably —
 * independent of the array's declaration order. That is precisely what makes it
 * safe to alphabetize the composition arrays (array position no longer decides
 * anything). Absent (conditional) entries must chain over, never dangle.
 *
 * @module services/assembly/extensionOrdering.test
 */
import { describe, it, expect } from "vitest";
import { deriveAfterConstraints, assertCanonicalCoverage } from "./extensionOrdering";
import { resolveExtensions } from "@/lib/extensions/resolve";
import type { VMarkExtension } from "@/lib/extensions/types";

/** Build minimal descriptors for `ids` (in the given array order) with the
 *  `after` constraints derived from `canonical`. */
function descriptorsFor(
  ids: readonly string[],
  canonical: readonly string[],
): VMarkExtension[] {
  const after = deriveAfterConstraints(canonical, ids);
  return ids.map((id) => ({
    id,
    contributions: [{ kind: "tiptap", factory: () => ({ name: id }) }],
    ordering: after.has(id) ? { after: after.get(id) } : undefined,
  }));
}

function resolvedOrder(ids: readonly string[], canonical: readonly string[]): string[] {
  const { ordered, errors } = resolveExtensions(descriptorsFor(ids, canonical));
  expect(errors).toEqual([]);
  return ordered.map((d) => d.id);
}

describe("deriveAfterConstraints", () => {
  const canonical = ["a", "b", "c", "d"] as const;

  it("chains each entry after its predecessor; the first gets none", () => {
    const c = deriveAfterConstraints(canonical, ["a", "b", "c", "d"]);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toEqual(["a"]);
    expect(c.get("c")).toEqual(["b"]);
    expect(c.get("d")).toEqual(["c"]);
  });

  it("chains over an ABSENT entry — no dangling reference to a missing id", () => {
    // `c` is absent → `d` must pin after `b`, not the missing `c`.
    const c = deriveAfterConstraints(canonical, ["a", "b", "d"]);
    expect(c.get("b")).toEqual(["a"]);
    expect(c.get("d")).toEqual(["b"]);
    expect([...c.values()].flat()).not.toContain("c");
  });

  it("ignores ids not in the canonical order (caller guards drift)", () => {
    const c = deriveAfterConstraints(canonical, ["a", "x"]);
    expect(c.get("a")).toBeUndefined();
    expect(c.has("x")).toBe(false);
  });
});

describe("resolution reproduces the canonical order regardless of array order", () => {
  const canonical = ["first", "second", "third", "fourth", "fifth"] as const;

  it("declaration order → canonical", () => {
    expect(resolvedOrder([...canonical], canonical)).toEqual([...canonical]);
  });

  it("REVERSED array → still canonical (permutation invariance)", () => {
    expect(resolvedOrder([...canonical].reverse(), canonical)).toEqual([...canonical]);
  });

  it("ALPHABETICAL array → still canonical", () => {
    expect(resolvedOrder([...canonical].sort(), canonical)).toEqual([...canonical]);
  });

  it("an arbitrary shuffle → still canonical", () => {
    expect(resolvedOrder(["third", "fifth", "first", "fourth", "second"], canonical)).toEqual([
      ...canonical,
    ]);
  });

  it("with a conditional entry absent, the remaining order is preserved", () => {
    // Drop "third"; the rest still resolve in canonical relative order.
    const present = ["fifth", "first", "fourth", "second"]; // shuffled, no "third"
    expect(resolvedOrder(present, canonical)).toEqual(["first", "second", "fourth", "fifth"]);
  });
});

describe("assertCanonicalCoverage — fail-loud drift guard", () => {
  const canonical = ["a", "b", "c"] as const;

  it("passes when present ids exactly match the canonical order", () => {
    expect(() => assertCanonicalCoverage("root", canonical, ["a", "b", "c"])).not.toThrow();
  });

  it("passes when an OPTIONAL id is absent from present", () => {
    expect(() => assertCanonicalCoverage("root", canonical, ["a", "b"], ["c"])).not.toThrow();
  });

  it("throws when a present id is missing from the canonical order", () => {
    expect(() => assertCanonicalCoverage("root", canonical, ["a", "b", "c", "z"])).toThrow(/z/);
  });

  it("throws when a canonical id is absent and not optional", () => {
    expect(() => assertCanonicalCoverage("root", canonical, ["a", "b"])).toThrow(/c/);
  });

  it("throws on a duplicated canonical id", () => {
    expect(() => assertCanonicalCoverage("root", ["a", "b", "b"], ["a", "b"])).toThrow(/b/);
  });
});
