// WI-5.1/5.2/5.3 — command-registry Phase 5 gates (ADR-015 D6).
/**
 * Phase 5 gate suite — the standing contracts that keep the editor→CommandBus
 * bridge honest:
 *
 *  - WI-5.1 ADOPTION (structural): every editor ActionId reaches the bus as
 *    ≥1 uniquely-registered `editor.*` spec; `setHeading` projects to EXACTLY
 *    levels 1..6 (no plain `editor.setHeading`); each spec's `run` targets the
 *    shared executor with the correct `(actionId, { windowLabel, params })`.
 *  - WI-5.2 DIFFERENTIAL: running `undo` / `paragraph` / `setHeading.2` THROUGH
 *    a bridge spec produces the byte-identical `runEditorAction` call the native
 *    menu path makes for the same action — one execution path, two entry points.
 *  - WI-5.3 INAPPLICABILITY: a non-document (browser) tab, Source mode, and
 *    read-only each hide (palette `actionAvailability`) / refuse (executor
 *    `isActionExecutable`) exactly the right actions.
 *
 * The executor is mocked so the ground truth for "what a spec runs" is the
 * captured call, not a re-derivation of the bridge's own logic.
 *
 * @module services/commands/editorCommandGates.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/editor/runEditorAction", () => ({ runEditorAction: vi.fn() }));
vi.mock("@/i18n", () => ({
  default: { t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key },
}));
// Format policy permits all category groups so WI-5.3's mode/read-only axes are
// isolated from format-policy gating.
const policy = { paragraphFormatting: true, insertBlockActions: true, cjkFormatActions: true };
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: () => ({ adapters: { menuPolicy: policy } }),
}));

import { buildEditorCommandSpecs } from "./editorCommandBridge";
import { runEditorAction } from "@/services/editor/runEditorAction";
import { actionAvailability, isActionExecutable } from "./actionAvailability";
import type { CommandContextResolved } from "./commandContext";
import { ACTION_DEFINITIONS, MENU_TO_ACTION } from "@/plugins/actions/actionRegistry";
import type { ActionId } from "@/plugins/actions/types";

const WL = "main";
const runMock = vi.mocked(runEditorAction);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Map every built spec to the `(actionId, options)` its `run()` actually
 * invokes on the executor. The mock is ground truth — this can't drift from
 * what the bridge really dispatches.
 */
function specRunTargets(): Array<{ id: string; actionId?: ActionId; options?: unknown }> {
  const specs = buildEditorCommandSpecs();
  return specs.map((spec) => {
    runMock.mockClear();
    spec.run(null, { windowLabel: WL });
    const call = runMock.mock.calls[0];
    return { id: spec.id, actionId: call?.[0] as ActionId | undefined, options: call?.[1] };
  });
}

describe("WI-5.1 — adoption gate", () => {
  it("every ActionId reaches the bus as a unique editor.* spec (fails if a new action skips the bridge)", () => {
    const targets = specRunTargets();
    const covered = new Set(targets.map((t) => t.actionId));
    const declared = new Set(Object.keys(ACTION_DEFINITIONS) as ActionId[]);
    expect(covered).toEqual(declared);

    const ids = targets.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate command ids
    expect(ids.every((id) => id.startsWith("editor."))).toBe(true);
  });

  it("setHeading projects to EXACTLY editor.setHeading.1..6 (no plain id), each run carrying its level", () => {
    const heading = specRunTargets().filter((t) => t.actionId === "setHeading");
    expect(heading.map((t) => t.id).sort()).toEqual([
      "editor.setHeading.1",
      "editor.setHeading.2",
      "editor.setHeading.3",
      "editor.setHeading.4",
      "editor.setHeading.5",
      "editor.setHeading.6",
    ]);
    // No un-runnable plain projection ever registers.
    expect(specRunTargets().some((t) => t.id === "editor.setHeading")).toBe(false);
    for (const t of heading) {
      const level = Number(t.id.split(".").pop());
      expect(t.options).toEqual({ windowLabel: WL, params: { level } });
    }
  });

  it("every non-heading spec runs its own ActionId with no params", () => {
    const targets = specRunTargets().filter((t) => t.actionId !== "setHeading");
    for (const t of targets) {
      expect(t.id).toBe(`editor.${t.actionId}`);
      expect(t.options).toEqual({ windowLabel: WL, params: undefined });
    }
  });
});

describe("WI-5.2 — bus↔menu differential (same execution path, two entry points)", () => {
  const specById = (id: string) => {
    const spec = buildEditorCommandSpecs().find((s) => s.id === id);
    if (!spec) throw new Error(`no spec ${id}`);
    return spec;
  };

  // Each menu event and its projected bridge spec must dispatch identically.
  const CASES = [
    { menu: "menu:undo", specId: "editor.undo" },
    { menu: "menu:paragraph", specId: "editor.paragraph" },
    { menu: "menu:heading-2", specId: "editor.setHeading.2" },
  ] as const;

  it.each(CASES)(
    "$specId via the bus makes the same runEditorAction call as $menu via the menu",
    ({ menu, specId }) => {
      const mapping = MENU_TO_ACTION[menu];

      // Menu path — exactly what useUnifiedMenuCommands does with the mapping.
      runMock.mockClear();
      runEditorAction(mapping.actionId, { windowLabel: WL, params: mapping.params });
      const menuCall = runMock.mock.calls[0];

      // Bus path — palette → spec.run → executor.
      runMock.mockClear();
      specById(specId).run(null, { windowLabel: WL });
      const busCall = runMock.mock.calls[0];

      expect(busCall).toEqual(menuCall);
    },
  );
});

describe("WI-5.3 — inapplicability gate", () => {
  function ctx(overrides: Partial<CommandContextResolved> = {}): CommandContextResolved {
    return {
      windowLabel: WL,
      mode: "wysiwyg",
      isDocument: true,
      formatId: "markdown",
      editorAvailable: true,
      readOnly: false,
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

  it("a non-document (browser) tab refuses AND hides every editing action", () => {
    const browser = ctx({ isDocument: false, editorAvailable: false });
    for (const id of ["bold", "insertTable", "setHeading"] as ActionId[]) {
      expect(isActionExecutable(id, browser)).toBe(false); // executor refuses
      expect(actionAvailability(id, browser)).toBe(false); // palette hides
    }
  });

  it("Source mode refuses WYSIWYG-only actions and WYSIWYG refuses source-only ones", () => {
    // Ground truth from the registry (documents the invariant under test).
    expect(ACTION_DEFINITIONS.toggleQuoteStyle.supports.source).toBe(false); // WYSIWYG-only
    expect(ACTION_DEFINITIONS.sortLinesAsc.supports.wysiwyg).toBe(false); // source-only

    expect(isActionExecutable("toggleQuoteStyle", ctx({ mode: "source" }))).toBe(false);
    expect(isActionExecutable("sortLinesAsc", ctx({ mode: "source" }))).toBe(true);
    expect(isActionExecutable("bold", ctx({ mode: "source" }))).toBe(true);

    expect(isActionExecutable("sortLinesAsc", ctx({ mode: "wysiwyg" }))).toBe(false);
    expect(isActionExecutable("toggleQuoteStyle", ctx({ mode: "wysiwyg" }))).toBe(true);
  });

  it("read-only refuses/hides mutating actions but leaves selection/navigation runnable", () => {
    const ro = ctx({ readOnly: true });
    // Mutating: refused by the executor and hidden from the palette.
    expect(isActionExecutable("bold", ro)).toBe(false);
    expect(actionAvailability("bold", ro)).toBe(false);
    // Non-mutating selection stays executable under read-only.
    expect(isActionExecutable("selectWord", ro)).toBe(true);
  });
});
