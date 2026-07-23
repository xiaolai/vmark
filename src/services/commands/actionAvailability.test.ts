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
import { describe, it, expect, vi } from "vitest";

const policy = { paragraphFormatting: true, insertBlockActions: true, cjkFormatActions: true };
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: () => ({ adapters: { menuPolicy: policy } }),
}));

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

describe("per-axis matrix", () => {
  // In a maximal context (all node axes + selection satisfied) every action that
  // supports the mode must be available — nothing is accidentally always-false.
  const maximal = ctx({
    hasSelection: true,
    multiSelection: true,
    inTable: true,
    inLink: true,
    inList: true,
    inBlockquote: true,
    inCodeBlock: true,
    inHeading: true,
  });

  it.each(ALL_IDS)("%s is available in a maximal context iff it supports WYSIWYG", (id) => {
    const supportsWysiwyg = ACTION_DEFINITIONS[id].supports.wysiwyg;
    expect(actionAvailability(id, maximal)).toBe(supportsWysiwyg);
  });

  it.each(ALL_IDS)("%s is unavailable with no document, whatever the axes", (id) => {
    expect(actionAvailability(id, { ...maximal, isDocument: false })).toBe(false);
  });

  it.each(ALL_IDS)("%s is unavailable with no editor mounted", (id) => {
    expect(actionAvailability(id, { ...maximal, editorAvailable: false })).toBe(false);
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
