/**
 * Contract for the single applicability source (structural merge): the
 * toolbar's enable contexts and the palette's requirements both derive from
 * ACTION_APPLICABILITY, so these rules are load-bearing for two surfaces.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_APPLICABILITY,
  enabledInFor,
  paletteRequirementFor,
} from "./actionApplicability";
import { isAdapterAction } from "./adapterActions";
import { TOOLBAR_GROUPS, isSeparator } from "@/components/Editor/UniversalToolbar/toolbarGroups";

describe("table integrity", () => {
  it("every key is a real adapter action", () => {
    for (const key of Object.keys(ACTION_APPLICABILITY)) {
      expect(isAdapterAction(key), `unknown action in table: ${key}`).toBe(true);
    }
  });

  it("every toolbar item's contexts come from the table", () => {
    for (const group of TOOLBAR_GROUPS) {
      for (const item of group.items) {
        if (isSeparator(item)) continue;
        expect(item.enabledIn, `item ${item.id}`).toEqual([...enabledInFor(item.action)]);
        // A toolbar item must have a REAL entry — falling back to "always"
        // would silently widen where a button is enabled.
        expect(ACTION_APPLICABILITY[item.action], `no applicability for ${item.action}`).toBeDefined();
      }
    }
  });
});

describe("palette derivation", () => {
  it("node-only contexts become requiresNode", () => {
    expect(paletteRequirementFor("addRow")).toEqual({ requiresNode: ["table"] });
    expect(paletteRequirementFor("removeList")).toEqual({ requiresNode: ["list"] });
    expect(paletteRequirementFor("nestBlockquote")).toEqual({ requiresNode: ["blockquote"] });
    expect(paletteRequirementFor("decreaseHeading")).toEqual({ requiresNode: ["heading"] });
  });

  it("a bare selection context becomes requiresSelection", () => {
    expect(paletteRequirementFor("clearFormatting")).toEqual({ requiresSelection: true });
    expect(paletteRequirementFor("transformUppercase")).toEqual({ requiresSelection: true });
  });

  it("textblock/mixed contexts impose nothing", () => {
    expect(paletteRequirementFor("bold")).toBeUndefined();
    expect(paletteRequirementFor("insertTable")).toBeUndefined();
    expect(paletteRequirementFor("bulletList")).toBeUndefined();
    expect(paletteRequirementFor("heading:1")).toBeUndefined();
  });

  it("heading:0 is palette-overridden to unrestricted (convert to paragraph)", () => {
    expect(enabledInFor("heading:0")).toEqual(["heading"]); // toolbar: heading-only
    expect(paletteRequirementFor("heading:0")).toBeUndefined(); // palette: anywhere
  });

  it("unknown / unconstrained actions impose nothing", () => {
    expect(paletteRequirementFor("undo")).toBeUndefined();
    expect(paletteRequirementFor("not-an-action")).toBeUndefined();
  });
});

describe("enabledInFor fallback", () => {
  it("actions outside the table are always enabled (utilities)", () => {
    expect(enabledInFor("undo")).toEqual(["always"]);
    expect(enabledInFor("selectWord")).toEqual(["always"]);
  });
});

describe("adapterActionMutates (shared read-only gate vocabulary)", () => {
  it("classifies mutating vs selection-only actions", async () => {
    const { adapterActionMutates } = await import("@/services/commands/actionAvailability");
    expect(adapterActionMutates("bold")).toBe(true);
    expect(adapterActionMutates("heading:2")).toBe(true);
    expect(adapterActionMutates("selectWord")).toBe(false);
    expect(adapterActionMutates("expandSelection")).toBe(false);
  });
});
