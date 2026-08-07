// @vitest-environment node
/**
 * Contract for the single applicability source (structural merge): the
 * toolbar's enable contexts and the palette's requirements both derive from
 * ACTION_APPLICABILITY, so these rules are load-bearing for two surfaces.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_APPLICABILITY,
  CODE_BLOCK_SAFE_ACTIONS,
  TABLE_CELL_BLOCKED_ACTIONS,
  enabledInFor,
  paletteRequirementFor,
} from "./actionApplicability";
import { isAdapterAction } from "./adapterActions";
import { TOOLBAR_GROUPS, isSeparator } from "@/components/Editor/UniversalToolbar/toolbarGroups";
// Statically imported: nothing here mocks this module, and resolving it INSIDE
// the test made a 5s-default assertion depend on how loaded the worker was.
import { adapterActionMutates } from "@/services/commands/actionAvailability";

describe("table integrity", () => {
  it("every key is a real adapter action", () => {
    for (const key of Object.keys(ACTION_APPLICABILITY)) {
      expect(isAdapterAction(key), `unknown action in table: ${key}`).toBe(true);
    }
  });

  // The two data-safety sets fail in OPPOSITE directions on a bad entry: a
  // typo in the table block-list fails OPEN (the action runs in a cell and the
  // serializer silently drops the block it created), a typo in the code-block
  // allow-list fails CLOSED (the action is refused wherever a fence is). The
  // arrays are compile-time typed now; this pins it at runtime too, so a
  // future `as` cast or widened type cannot quietly reopen the hole.
  it.each([
    { name: "TABLE_CELL_BLOCKED_ACTIONS", set: TABLE_CELL_BLOCKED_ACTIONS },
    { name: "CODE_BLOCK_SAFE_ACTIONS", set: CODE_BLOCK_SAFE_ACTIONS },
  ])("every member of $name is a real adapter action", ({ set }) => {
    for (const action of set) {
      expect(isAdapterAction(action), `unknown action in policy set: ${action}`).toBe(true);
    }
  });

  it("the policy sets cover every heading level exactly once", () => {
    for (let level = 0; level <= 6; level++) {
      expect(TABLE_CELL_BLOCKED_ACTIONS.has(`heading:${level}`)).toBe(true);
    }
    expect(TABLE_CELL_BLOCKED_ACTIONS.has("heading:7")).toBe(false);
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
  it("classifies mutating vs selection-only actions", () => {
    expect(adapterActionMutates("bold")).toBe(true);
    expect(adapterActionMutates("heading:2")).toBe(true);
    expect(adapterActionMutates("selectWord")).toBe(false);
    expect(adapterActionMutates("expandSelection")).toBe(false);
  });
});
