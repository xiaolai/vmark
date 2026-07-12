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
