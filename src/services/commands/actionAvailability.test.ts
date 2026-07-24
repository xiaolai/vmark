/**
 * Availability policy tests — command-registry WI-2.2 (Phase 2).
 *
 * Coverage: the no-document and no-editor axes are EXHAUSTIVE (every ActionId);
 * the selection / node / link / multi-selection axes are targeted with explicit,
 * independent expectations (not derived from the same registry data as
 * production). Plus the executor gate (isActionExecutable), format-policy
 * category branches + WI-1A.7, and mutatesDocument.
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
import type { MultiSelectionContext } from "@/plugins/toolbarActions/types";

function ctx(overrides: Partial<CommandContextResolved> = {}): CommandContextResolved {
  return {
    windowLabel: "main",
    mode: "wysiwyg",
    isDocument: true,
    formatId: "markdown",
    editorAvailable: true,
    readOnly: false,
    hasSelection: false,
    multiSelection: null,
    inTable: false,
    inLink: false,
    inList: false,
    inBlockquote: false,
    inCodeBlock: false,
    inHeading: false,
    ...overrides,
  };
}

/**
 * A multi-selection context. Defaults to the permissive case — >1 cursor, all in
 * one shared textblock, no universal-veto node — so overrides target exactly the
 * axis under test (`sameBlockParent`/`inTextblock` for the conditional rule; a
 * veto flag for the universal rule).
 */
function ms(overrides: Partial<MultiSelectionContext> = {}): MultiSelectionContext {
  return {
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

describe("multi-selection (delegates to the adapters' canRunActionInMultiSelection)", () => {
  // Everything the adapters' multi-selection gate rejects (explicit "disallow"
  // OR the unlisted default: inserts, tables, links, code, selection, cjk,
  // cleanup, lines, transform, increase/decreaseHeading, blockquote toggle).
  // The context is clean (shared textblock, no veto) so the "disallow" policy —
  // not a context veto — is what hides them.
  it.each([
    "insertTable",
    "insertImage",
    "insertVideo", // unlisted → default disallow (the earlier category-miss)
    "insertAudio",
    "deleteTable",
    "addRowBelow",
    "link",
    "wikiLink", // → link:wiki, unlisted → default disallow
    "bookmark",
    "codeBlock", // → insertCodeBlock, disallow
    "blockquote", // → insertBlockquote, disallow
    "increaseHeading", // unlisted → default disallow (NOT the heading:N conditional)
    "selectWord",
    "moveLineUp",
    "formatCJK",
    "transformUppercase",
  ] as ActionId[])("%s is hidden under multi-selection", (id) => {
    expect(actionAvailability(id, ctx({ multiSelection: ms(), inTable: true, inList: true }))).toBe(false);
  });

  // Bypass actions (history), policy-"allow" marks, and "conditional" structural
  // actions remain available in a CLEAN shared-context multi-selection.
  it.each([
    "undo", // routes through unified history, bypasses the gate
    "redo",
    "setHeading", // adapter evaluates as heading:N ("conditional")
    "paragraph",
    "bold", // policy "allow"
    "italic",
    "bulletList", // policy "conditional"
    "indent",
    "nestBlockquote",
  ] as ActionId[])("%s remains available under a clean shared multi-selection", (id) => {
    expect(actionAvailability(id, ctx({ multiSelection: ms(), inList: true, inBlockquote: true }))).toBe(true);
  });

  it("clearFormatting is available under multi-selection even with a collapsed primary", () => {
    expect(actionAvailability("clearFormatting", ctx({ multiSelection: ms(), hasSelection: false }))).toBe(true);
  });

  // Residual (b) — command-registry WI-2.2: the universal context vetoes. Any
  // cursor inside one of these nodes disables EVERY multi-selection action,
  // including policy-"allow" marks. Previously the palette did not reproduce this.
  it.each([
    "inCodeBlock",
    "inTable",
    "inLink",
    "inImage",
    "inInlineMath",
    "inFootnote",
  ] as (keyof MultiSelectionContext)[])(
    "universal veto: %s hides even policy-allow marks (bold) under multi-selection",
    (flag) => {
      expect(actionAvailability("bold", ctx({ multiSelection: ms({ [flag]: true }) }))).toBe(false);
    },
  );

  it("policy-allow marks stay available under a clean (unvetoed) multi-selection", () => {
    expect(actionAvailability("bold", ctx({ multiSelection: ms() }))).toBe(true);
    expect(actionAvailability("italic", ctx({ multiSelection: ms() }))).toBe(true);
  });

  // Residual (a) — command-registry WI-2.2: "conditional" actions are gated on
  // all cursors sharing a structural context. Previously the palette showed them
  // (and bypassed setHeading/paragraph entirely) regardless of that condition.
  it.each(["setHeading", "paragraph", "bulletList", "indent", "nestBlockquote"] as ActionId[])(
    "conditional %s is hidden when cursors don't share a block parent",
    (id) => {
      expect(
        actionAvailability(
          id,
          ctx({ multiSelection: ms({ sameBlockParent: false }), inList: true, inBlockquote: true }),
        ),
      ).toBe(false);
    },
  );

  it("conditional actions are hidden when not every cursor is in a textblock", () => {
    expect(
      actionAvailability("bulletList", ctx({ multiSelection: ms({ inTextblock: false }), inList: true })),
    ).toBe(false);
  });

  it("undo/redo bypass the gate even under a context veto", () => {
    expect(actionAvailability("undo", ctx({ multiSelection: ms({ inCodeBlock: true }) }))).toBe(true);
    expect(actionAvailability("redo", ctx({ multiSelection: ms({ inTable: true }) }))).toBe(true);
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

describe("read-only (Phase 2b) — mutating actions hidden, others kept", () => {
  it("hides mutating actions under read-only", () => {
    expect(actionAvailability("bold", ctx({ readOnly: true }))).toBe(false);
    expect(actionAvailability("insertTable", ctx({ readOnly: true }))).toBe(false);
    expect(actionAvailability("undo", ctx({ readOnly: true }))).toBe(false); // undo mutates
  });

  it("keeps non-mutating selection/navigation actions under read-only", () => {
    expect(actionAvailability("selectWord", ctx({ readOnly: true }))).toBe(true);
    expect(actionAvailability("selectLine", ctx({ readOnly: true }))).toBe(true);
    expect(actionAvailability("expandSelection", ctx({ readOnly: true }))).toBe(true);
  });

  it("mutating actions ARE available when not read-only", () => {
    expect(actionAvailability("bold", ctx({ readOnly: false }))).toBe(true);
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
