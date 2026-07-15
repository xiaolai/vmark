// WI-4.4 / R8a — self-healing: propose a same-role locator fix from the snapshot
import { describe, it, expect } from "vitest";
import { proposeLocatorFix, type SnapshotNode } from "./selfHeal";

const snap = (nodes: Array<[string, string]>): SnapshotNode[] =>
  nodes.map(([role, name]) => ({ role, name }));

describe("proposeLocatorFix", () => {
  it("proposes the closest same-role name for a typo'd locator", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Publsh" },
      snap([["button", "Publish"], ["button", "Cancel"], ["link", "Publish"]]),
    );
    expect(fix).not.toBeNull();
    expect(fix).toMatchObject({ role: "button", name: "Publish" });
    expect(fix!.confidence).toBeGreaterThan(0.6);
  });

  it("never heals across roles (a link is not a button fix)", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Publish" },
      snap([["link", "Publish"]]),
    );
    expect(fix).toBeNull();
  });

  it("returns null when no same-role name is similar enough", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Submit" },
      snap([["button", "Xyzabc"]]),
    );
    expect(fix).toBeNull();
  });

  it("picks the most similar among several same-role candidates", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Loginn" },
      snap([["button", "Log out"], ["button", "Login"]]),
    );
    expect(fix).toMatchObject({ name: "Login" });
  });

  it("is case-insensitive on the name", () => {
    const fix = proposeLocatorFix(
      { role: "link", name: "learn MORE" },
      snap([["link", "Learn more"]]),
    );
    expect(fix).toMatchObject({ name: "Learn more" });
    expect(fix!.confidence).toBe(1);
  });

  it("respects a custom minConfidence threshold", () => {
    const nodes = snap([["button", "Save changes"]]);
    // "Save" vs "Save changes" — moderate similarity; strict threshold rejects it.
    expect(proposeLocatorFix({ role: "button", name: "Save" }, nodes, { minConfidence: 0.9 })).toBeNull();
    expect(proposeLocatorFix({ role: "button", name: "Save" }, nodes, { minConfidence: 0.3 })).not.toBeNull();
  });

  it("returns null for an empty snapshot", () => {
    expect(proposeLocatorFix({ role: "button", name: "Publish" }, [])).toBeNull();
  });

  it("returns null when two same-role candidates TIE for best (ambiguous — repair nothing)", () => {
    // Snapshot order used to decide the winner; a coin-flip locator can act on the
    // wrong control in a repaired workflow.
    const fix = proposeLocatorFix(
      { role: "button", name: "Save" },
      snap([["button", "Save1"], ["button", "Save2"]]),
    );
    expect(fix).toBeNull();
  });

  it("returns null when the winning name is DUPLICATED (the locator would not be unique)", () => {
    // A role+name locator must identify one element; two identical buttons means the
    // executor would silently pick the first.
    const fix = proposeLocatorFix(
      { role: "button", name: "Publsh" },
      snap([["button", "Publish"], ["button", "Publish"]]),
    );
    expect(fix).toBeNull();
  });

  it("still proposes when one candidate is uniquely best among duplicates of another name", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Publsh" },
      snap([["button", "Publish"], ["button", "Cancel"], ["button", "Cancel"]]),
    );
    expect(fix).toMatchObject({ name: "Publish" });
  });

  it("treats canonically equivalent Unicode names as identical (NFC)", () => {
    const decomposed = "Cafe\u0301"; // e + combining acute (NFD)
    const composed = "Caf\u00e9"; // precomposed \u00e9 (NFC)
    expect(decomposed).not.toBe(composed); // different code units, same rendered text
    const fix = proposeLocatorFix({ role: "link", name: decomposed }, snap([["link", composed]]));
    expect(fix?.confidence).toBe(1);
  });

  it("measures distance in code points, not UTF-16 units (emoji count once)", () => {
    const fix = proposeLocatorFix({ role: "button", name: "Send 🚀" }, snap([["button", "Send 🎉"]]));
    // 6 code points, one substitution → 5/6. Counting UTF-16 units would say 5/7.
    expect(fix?.confidence).toBeCloseTo(5 / 6, 5);
  });

  it("rejects a minConfidence outside the documented [0,1] domain", () => {
    const nodes = snap([["button", "Save"]]);
    const failed = { role: "button", name: "Save" };
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: NaN })).toThrow(RangeError);
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: -1 })).toThrow(RangeError);
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: 1.5 })).toThrow(RangeError);
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: Infinity })).toThrow(RangeError);
    // The boundaries themselves are valid.
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: 0 })).not.toThrow();
    expect(() => proposeLocatorFix(failed, nodes, { minConfidence: 1 })).not.toThrow();
  });

  it("bounds the work on adversarial page content (very long accessible names)", () => {
    const huge = "a".repeat(200_000);
    const started = performance.now();
    // Unhealable in both directions: a 200k-char "name" is not a locator.
    expect(proposeLocatorFix({ role: "button", name: "Save" }, snap([["button", huge]]))).toBeNull();
    expect(
      proposeLocatorFix({ role: "button", name: `${huge}x` }, snap([["button", `${huge}y`]])),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("handles identical and empty names (edit-distance edge cases)", () => {
    // Exact same name → confidence 1.
    expect(
      proposeLocatorFix({ role: "button", name: "Save" }, snap([["button", "Save"]])),
    ).toMatchObject({ name: "Save", confidence: 1 });
    // Both empty → treated as identical (similarity 1).
    expect(
      proposeLocatorFix({ role: "button", name: "" }, snap([["button", ""]])),
    ).toMatchObject({ confidence: 1 });
    // Empty vs non-empty → dissimilar, below threshold.
    expect(proposeLocatorFix({ role: "button", name: "" }, snap([["button", "Save"]]))).toBeNull();
  });
});
