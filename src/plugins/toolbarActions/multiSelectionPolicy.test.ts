// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canRunActionInMultiSelection, getMultiSelectionPolicyForAction } from "./multiSelectionPolicy";
import type { MultiSelectionContext } from "./types";

const baseContext: MultiSelectionContext = {
  enabled: true,
  reason: "multi",
  inCodeBlock: false,
  inTable: false,
  inList: false,
  inBlockquote: false,
  inHeading: false,
  inLink: false,
  inInlineMath: false,
  inFootnote: false,
  inImage: false,
  inTextblock: true,
  sameBlockParent: true,
  blockParentType: "paragraph",
};

describe("multi-selection policy", () => {
  it("returns policy for known actions", () => {
    expect(getMultiSelectionPolicyForAction("bold")).toBe("allow");
    expect(getMultiSelectionPolicyForAction("heading:1")).toBe("conditional");
    expect(getMultiSelectionPolicyForAction("insertTable")).toBe("disallow");
  });

  it("allows inline marks when compatible", () => {
    expect(canRunActionInMultiSelection("bold", baseContext)).toBe(true);
    expect(canRunActionInMultiSelection("code", baseContext)).toBe(true);
  });

  it("disallows inserts and table actions during multi-selection", () => {
    expect(canRunActionInMultiSelection("insertTable", baseContext)).toBe(false);
    expect(canRunActionInMultiSelection("addRow", baseContext)).toBe(false);
  });

  it("blocks conditional actions when in disallowed contexts", () => {
    expect(
      canRunActionInMultiSelection("heading:2", { ...baseContext, inCodeBlock: true })
    ).toBe(false);
    expect(
      canRunActionInMultiSelection("bulletList", { ...baseContext, inTable: true })
    ).toBe(false);
    expect(
      canRunActionInMultiSelection("orderedList", { ...baseContext, sameBlockParent: false })
    ).toBe(false);
  });

  it("returns disallow for unknown action (line 75 fallback)", () => {
    expect(getMultiSelectionPolicyForAction("unknownAction")).toBe("disallow");
  });

  it("allows actions when multi-selection is not enabled", () => {
    expect(canRunActionInMultiSelection("insertTable", { ...baseContext, enabled: false })).toBe(true);
  });

  it("allows actions when multi context is undefined", () => {
    expect(canRunActionInMultiSelection("insertTable", undefined)).toBe(true);
  });

  it("blocks allow-policy actions when inLink (line 89)", () => {
    expect(
      canRunActionInMultiSelection("bold", { ...baseContext, inLink: true })
    ).toBe(false);
  });

  it("blocks allow-policy actions when inImage (line 89)", () => {
    expect(
      canRunActionInMultiSelection("italic", { ...baseContext, inImage: true })
    ).toBe(false);
  });

  it("blocks allow-policy actions when inInlineMath (line 89)", () => {
    expect(
      canRunActionInMultiSelection("bold", { ...baseContext, inInlineMath: true })
    ).toBe(false);
  });

  it("blocks allow-policy actions when inFootnote (line 89)", () => {
    expect(
      canRunActionInMultiSelection("bold", { ...baseContext, inFootnote: true })
    ).toBe(false);
  });

  it("blocks conditional actions when not in textblock (line 93)", () => {
    expect(
      canRunActionInMultiSelection("heading:1", { ...baseContext, inTextblock: false })
    ).toBe(false);
  });

  it("allows conditional actions when all conditions met", () => {
    expect(
      canRunActionInMultiSelection("heading:1", baseContext)
    ).toBe(true);
  });
});

describe("history actions under multi-selection", () => {
  it("allows undo and redo (previously fell to the disallow default)", () => {
    expect(canRunActionInMultiSelection("undo", baseContext)).toBe(true);
    expect(canRunActionInMultiSelection("redo", baseContext)).toBe(true);
  });
});
