// @vitest-environment node
// WI-4.4 / R8a — self-healing: propose a same-role locator fix from the snapshot
import { describe, it, expect } from "vitest";
import { expectBoundedTime } from "@/test/timeBudget";
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
    // "Sign in nowx" vs "Sign in now": one edit in 12 code points (0.917) clears the
    // non-prefix floor; "Sign out" does not.
    const fix = proposeLocatorFix(
      { role: "button", name: "Sign in nowx" },
      snap([["button", "Sign out"], ["button", "Sign in now"]]),
    );
    expect(fix).toMatchObject({ name: "Sign in now" });
  });

  it("a short typo'd name that is not a prefix of the candidate needs ≥ 0.85 (W3)", () => {
    // "Loginn" → "Login" is 0.833: below the non-prefix floor, so nothing is proposed.
    expect(proposeLocatorFix({ role: "button", name: "Loginn" }, snap([["button", "Login"]]))).toBeNull();
    // "Publsh" → "Publish" is 0.857: above it.
    expect(proposeLocatorFix({ role: "button", name: "Publsh" }, snap([["button", "Publish"]]))).toMatchObject({
      name: "Publish",
    });
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
    const fix = proposeLocatorFix({ role: "button", name: "Send it now 🚀" }, snap([["button", "Send it now 🎉"]]));
    // 13 code points, one substitution → 12/13. Counting UTF-16 units would say 12/14
    // (both surrogate halves differ), which is below the 0.85 non-prefix floor.
    expect(fix?.confidence).toBeCloseTo(12 / 13, 5);
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
    expectBoundedTime(performance.now() - started, {
      budgetMs: 500, livenessMs: 10_000,
      label: "selfHeal candidate search",
    });
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

// Audit 2026-09-03 W-03 — self-heal must never repair a locator onto its
// ANTONYM. The inverse control ("Unpublish") appears exactly in the state after
// the action already happened, and under a standing grant it would run with no
// prompt. Rule: a candidate whose normalised name is the failed name with an
// added PREFIX is rejected; suffix/decoration drift ("Publish now") still heals.
describe("proposeLocatorFix — antonym rejection (W3)", () => {
  it.each([
    ["Publish", "Unpublish"],
    ["Subscribe", "Unsubscribe"],
    ["Delete", "Undelete"],
    ["Post", "Repost"],
    ["Approve", "Disapprove"],
    ["Follow", "Unfollow"],
    ["Like", "Unlike"],
    ["Mute", "Unmute"],
    ["Lock", "Unlock"],
    ["Archive", "Unarchive"],
    ["Hide", "Unhide"],
    ["Check", "Uncheck"],
    ["Pin", "Unpin"],
    ["Star", "Unstar"],
    ["Block", "Unblock"],
    ["Allow", "Disallow"],
    ["Connect", "Disconnect"],
    ["Install", "Uninstall"],
    ["Register", "Deregister"],
    ["Select", "Deselect"],
    ["Activate", "Deactivate"],
    ["Publish", "Republish"],
    ["publish", "Cancel publish"],
    ["Enable", "Disable"],
    ["Accept", "Reject"],
  ])("never heals %s → %s", (failed, antonym) => {
    expect(proposeLocatorFix({ role: "button", name: failed }, snap([["button", antonym]]))).toBeNull();
  });

  it("does not heal in the reverse direction either (Unpublish → Publish)", () => {
    expect(proposeLocatorFix({ role: "button", name: "Unpublish" }, snap([["button", "Publish"]]))).toBeNull();
  });

  it("still heals suffix/decoration drift on the same name", () => {
    for (const decorated of ["Publish now", "Publish…", "Publish (1)", "Publish ▸"]) {
      const fix = proposeLocatorFix({ role: "button", name: "Publish" }, snap([["button", decorated]]));
      expect(fix).toMatchObject({ name: decorated });
      expect(fix!.confidence).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("prefers the decorated same-name control over the antonym when both are present", () => {
    const fix = proposeLocatorFix(
      { role: "button", name: "Publish" },
      snap([["button", "Unpublish"], ["button", "Publish now"]]),
    );
    expect(fix).toMatchObject({ name: "Publish now" });
  });

  it("strips Unicode format characters before comparing (a zero-width or bidi mark is not drift)", () => {
    expect(
      proposeLocatorFix({ role: "button", name: "Publish" }, snap([["button", "Pub\u200Blish"]])),
    ).toMatchObject({ confidence: 1 });
    expect(
      proposeLocatorFix({ role: "button", name: "Publish" }, snap([["button", "\u202EPublish\u202C"]])),
    ).toMatchObject({ confidence: 1 });
    // …and a format character cannot disguise an antonym as decoration.
    expect(proposeLocatorFix({ role: "button", name: "Publish" }, snap([["button", "Un\u200Bpublish"]]))).toBeNull();
  });
});
