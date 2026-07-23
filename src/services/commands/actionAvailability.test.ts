/**
 * Availability policy tests — command-registry WI-2.2 (Phase 2).
 *
 * The per-axis matrix DoD: every ActionId, across {no-selection, in-table,
 * in-link, in-list, multi-selection, source-only, wysiwyg-only, no-editor,
 * no-document}, resolves to the expected availability. Plus the executor gate
 * (isActionExecutable), format policy, and mutatesDocument.
 *
 * @module services/commands/actionAvailability.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const policy = { paragraphFormatting: true, insertBlockActions: true, cjkFormatActions: true };
const reg = { present: true };
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: () => (reg.present ? { adapters: { menuPolicy: policy } } : undefined),
}));

beforeEach(() => {
  policy.paragraphFormatting = true;
  policy.insertBlockActions = true;
  policy.cjkFormatActions = true;
  reg.present = true;
});

import { isActionExecutable, actionAvailability, mutatesDocument } from "./actionAvailability";
import type { CommandContextResolved } from "./commandContext";
import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import type { ActionId } from "@/plugins/actions/types";

function ctx(overrides: Partial<CommandContextResolved> = {}): CommandContextResolved {
  return {
    windowLabel: "main",
    mode: "wysiwyg",
    isDocument: true,
    formatId: "markdown",
    editorAvailable: true,
    hasSelection: false,
    multiSelection: false,
    inTable: false,
    inLink: false,
    inList: false,
    inBlockquote: false,
    inCodeBlock: false,
    inHeading: false,
    ...overrides,
  };
}

const ALL_IDS = Object.keys(ACTION_DEFINITIONS) as ActionId[];

describe("isActionExecutable — the executor gate", () => {
  it("allows a plain formatting action on a live document", () => {
    expect(isActionExecutable("bold", ctx())).toBe(true);
  });

  it("fails closed without a live document tab", () => {
    expect(isActionExecutable("bold", ctx({ isDocument: false }))).toBe(false);
  });

  it("does NOT require a mounted editor (the executor's retry handles that)", () => {
    expect(isActionExecutable("bold", ctx({ editorAvailable: false }))).toBe(true);
  });

  it("respects mode capability", () => {
    // insertImage is WYSIWYG-only in the real registry.
    const img = ACTION_DEFINITIONS.insertImage;
    if (img && !img.supports.source) {
      expect(isActionExecutable("insertImage", ctx({ mode: "source" }))).toBe(false);
      expect(isActionExecutable("insertImage", ctx({ mode: "wysiwyg" }))).toBe(true);
    }
  });

  it("respects the format's category policy", () => {
    policy.insertBlockActions = false;
    // insertTable is category "tables" → gated by insertBlockActions.
    expect(isActionExecutable("insertTable", ctx())).toBe(false);
    policy.insertBlockActions = true;
    expect(isActionExecutable("insertTable", ctx())).toBe(true);
  });

  it("gates paragraph-formatting categories by paragraphFormatting", () => {
    policy.paragraphFormatting = false;
    expect(isActionExecutable("bold", ctx())).toBe(false); // formatting
    expect(isActionExecutable("setHeading", ctx())).toBe(false); // headings
  });

  it("gates cjk/cleanup/transform categories by cjkFormatActions", () => {
    policy.cjkFormatActions = false;
    expect(isActionExecutable("formatCJK", ctx())).toBe(false);
  });

  it("always allows edit/selection/lines categories regardless of format policy", () => {
    policy.paragraphFormatting = false;
    policy.insertBlockActions = false;
    policy.cjkFormatActions = false;
    expect(isActionExecutable("undo", ctx())).toBe(true); // edit
    expect(isActionExecutable("selectWord", ctx())).toBe(true); // selection
    expect(isActionExecutable("moveLineUp", ctx())).toBe(true); // lines
  });

  it("fails OPEN for a document tab whose format is unregistered (WI-1A.7)", () => {
    reg.present = false; // getFormatById returns undefined
    expect(isActionExecutable("insertTable", ctx({ formatId: "exotic" }))).toBe(true);
  });
});

describe("actionAvailability — the palette gate", () => {
  it("hides everything when no editor is mounted", () => {
    expect(actionAvailability("bold", ctx({ editorAvailable: false }))).toBe(false);
  });

  it("deleteTable is unavailable outside a table, available inside one", () => {
    expect(actionAvailability("deleteTable", ctx())).toBe(false);
    expect(actionAvailability("deleteTable", ctx({ inTable: true }))).toBe(true);
  });

  it("bold on a browser tab (no document) is false", () => {
    expect(actionAvailability("bold", ctx({ isDocument: false }))).toBe(false);
  });

  it("clearFormatting requires a selection", () => {
    expect(actionAvailability("clearFormatting", ctx())).toBe(false);
    expect(actionAvailability("clearFormatting", ctx({ hasSelection: true }))).toBe(true);
  });

  it("blockquote nesting requires being in a blockquote", () => {
    expect(actionAvailability("nestBlockquote", ctx())).toBe(false);
    expect(actionAvailability("nestBlockquote", ctx({ inBlockquote: true }))).toBe(true);
  });

  it("removeList requires being in a list", () => {
    expect(actionAvailability("removeList", ctx())).toBe(false);
    expect(actionAvailability("removeList", ctx({ inList: true }))).toBe(true);
  });

  it("a plain action with no positional requirement is available on a live doc", () => {
    expect(actionAvailability("italic", ctx())).toBe(true);
  });
});

describe("multi-selection policy (reuses MULTI_SELECTION_POLICY)", () => {
  it("hides actions the multi-cursor policy explicitly disallows", () => {
    // insertTable / insertImage / table mutations / link are policy-"disallow".
    expect(actionAvailability("insertTable", ctx({ multiSelection: true }))).toBe(false);
    expect(actionAvailability("insertImage", ctx({ multiSelection: true }))).toBe(false);
    expect(actionAvailability("deleteTable", ctx({ multiSelection: true, inTable: true }))).toBe(false);
    expect(actionAvailability("link", ctx({ multiSelection: true }))).toBe(false);
  });

  it("keeps policy-'allow' mark actions available under multi-selection", () => {
    expect(actionAvailability("bold", ctx({ multiSelection: true }))).toBe(true);
    expect(actionAvailability("italic", ctx({ multiSelection: true }))).toBe(true);
  });

  it("clearFormatting is available under multi-selection even with a collapsed primary", () => {
    expect(actionAvailability("clearFormatting", ctx({ multiSelection: true, hasSelection: false }))).toBe(true);
  });
});

describe("link context (reuses LINK_DISABLED_ACTIONS)", () => {
  it.each(["link", "wikiLink", "bookmark", "code"] as ActionId[])(
    "%s is unavailable inside an existing link",
    (id) => {
      expect(actionAvailability(id, ctx({ inLink: true }))).toBe(false);
      expect(actionAvailability(id, ctx({ inLink: false }))).toBe(true);
    },
  );
});

describe("list indent/outdent require a list", () => {
  it.each(["indent", "outdent"] as ActionId[])("%s requires being in a list", (id) => {
    expect(actionAvailability(id, ctx())).toBe(false);
    expect(actionAvailability(id, ctx({ inList: true }))).toBe(true);
  });
});

describe("completeness — nothing is accidentally always-false", () => {
  // A single rich selection (NOT multi) with every node axis satisfied: every
  // action that supports WYSIWYG must be reachable somewhere.
  const rich = ctx({
    hasSelection: true,
    inTable: true,
    inLink: false, // link context forbids link actions; keep it off here
    inList: true,
    inBlockquote: true,
    inCodeBlock: true,
    inHeading: true,
  });

  it.each(ALL_IDS)("%s is available in a rich single-selection iff it supports WYSIWYG", (id) => {
    expect(actionAvailability(id, rich)).toBe(ACTION_DEFINITIONS[id].supports.wysiwyg);
  });

  it.each(ALL_IDS)("%s is unavailable with no document", (id) => {
    expect(actionAvailability(id, { ...rich, isDocument: false })).toBe(false);
  });

  it.each(ALL_IDS)("%s is unavailable with no editor mounted", (id) => {
    expect(actionAvailability(id, { ...rich, editorAvailable: false })).toBe(false);
  });
});

describe("mutatesDocument", () => {
  it.each(["selectWord", "selectLine", "selectBlock", "expandSelection"] as ActionId[])(
    "%s does not mutate the document",
    (id) => {
      expect(mutatesDocument(id)).toBe(false);
    },
  );

  it.each(["bold", "undo", "insertTable", "deleteTable"] as ActionId[])(
    "%s mutates the document",
    (id) => {
      expect(mutatesDocument(id)).toBe(true);
    },
  );
});
