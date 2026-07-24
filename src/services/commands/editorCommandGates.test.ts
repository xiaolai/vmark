// WI-5.1/5.2/5.3 — command-registry Phase 5 gates (ADR-015 D6).
/**
 * Phase 5 gate suite — the standing contracts that keep the editor→CommandBus
 * bridge honest:
 *
 *  - WI-5.1 ADOPTION (structural): every editor ActionId reaches the bus as
 *    ≥1 uniquely-registered `editor.*` spec that dispatches EXACTLY ONCE;
 *    `setHeading` projects to EXACTLY levels 1..6 (no plain `editor.setHeading`);
 *    each spec's `run` targets the shared executor with the correct
 *    `(actionId, { windowLabel, params })`.
 *  - WI-5.2 DIFFERENTIAL: running `undo` / `paragraph` / `setHeading.2` THROUGH
 *    a bridge spec produces the byte-identical `runEditorAction` call the REAL
 *    menu dispatch (`dispatchMenuAction`, the exact line the menu listener runs)
 *    makes for the same action — one execution path, two entry points.
 *  - WI-5.3 INAPPLICABILITY: a non-document (browser) tab, Source/WYSIWYG mode,
 *    and read-only each hide (palette `actionAvailability`) / refuse (executor
 *    `isActionExecutable`) exactly the right actions — with positive controls so
 *    a `() => false` stub could never satisfy the suite.
 *
 * The executor is mocked so the ground truth for "what a spec runs" is the
 * captured call, not a re-derivation of the bridge's own logic. Every dispatch
 * is asserted to fire exactly once, so a spec that ALSO makes a spurious second
 * call cannot slip through.
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
import { dispatchMenuAction } from "@/hooks/useUnifiedMenuCommands";
import { actionAvailability, isActionExecutable } from "./actionAvailability";
import type { CommandContextResolved } from "./commandContext";
import { ACTION_DEFINITIONS, MENU_TO_ACTION } from "@/plugins/actions/actionRegistry";
import type { ActionId, MenuEventId } from "@/plugins/actions/types";

const WL = "main";
const runMock = vi.mocked(runEditorAction);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Map every built spec to the `(actionId, options)` its `run()` invokes on the
 * executor. Asserts each spec dispatches EXACTLY ONCE — the mock is ground
 * truth, so this can't drift from what the bridge really dispatches, and a
 * spec that fires a spurious extra call is caught here.
 */
function specRunTargets(): Array<{ id: string; actionId: ActionId; options: unknown }> {
  const specs = buildEditorCommandSpecs();
  return specs.map((spec) => {
    runMock.mockClear();
    spec.run(null, { windowLabel: WL });
    expect(runMock).toHaveBeenCalledTimes(1);
    const [actionId, options] = runMock.mock.calls[0];
    return { id: spec.id, actionId: actionId as ActionId, options };
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
    const targets = specRunTargets();
    const heading = targets.filter((t) => t.actionId === "setHeading");
    expect(heading.map((t) => t.id).sort()).toEqual([
      "editor.setHeading.1",
      "editor.setHeading.2",
      "editor.setHeading.3",
      "editor.setHeading.4",
      "editor.setHeading.5",
      "editor.setHeading.6",
    ]);
    // No un-runnable plain projection ever registers.
    expect(targets.some((t) => t.id === "editor.setHeading")).toBe(false);
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

  // The bridge spec id a given menu EVENT must converge on. For headings the
  // expected level is read from the event NAME (menu:heading-N), NOT from the
  // mapping's own params — otherwise the expectation would be circular and a
  // `menu:heading-3 → { level: 4 }` drift would pick editor.setHeading.4 and
  // silently agree. Deriving N from the name means the dispatch comparison
  // (which uses params) actually fails on such a mismatch.
  const HEADING_EVENT = /^menu:heading-([1-6])$/;
  const specIdFor = (menu: MenuEventId, mapping: (typeof MENU_TO_ACTION)[MenuEventId]): string => {
    const headingMatch = menu.match(HEADING_EVENT);
    if (headingMatch) return `editor.setHeading.${headingMatch[1]}`;
    return `editor.${mapping.actionId}`;
  };

  // EXHAUSTIVE: every menu event must dispatch identically to its bridge spec —
  // a per-level heading mismatch (menu:heading-3 → level 4) or a params drift on
  // any single action is caught, not just the three sampled earlier.
  const CASES = (Object.keys(MENU_TO_ACTION) as MenuEventId[]).map((menu) => ({
    menu,
    specId: specIdFor(menu, MENU_TO_ACTION[menu]),
  }));

  it("has menu events to check (guards against a vacuous it.each on empty MENU_TO_ACTION)", () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES)(
    "$specId via the bus makes the same single runEditorAction call as $menu via the REAL menu dispatch",
    ({ menu, specId }) => {
      // Menu path — the ACTUAL production dispatch the listener runs.
      runMock.mockClear();
      dispatchMenuAction(MENU_TO_ACTION[menu], WL);
      expect(runMock).toHaveBeenCalledTimes(1);
      const menuCall = runMock.mock.calls[0];

      // Bus path — palette → spec.run → executor.
      runMock.mockClear();
      specById(specId).run(null, { windowLabel: WL });
      expect(runMock).toHaveBeenCalledTimes(1);
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

  const ALL = Object.keys(ACTION_DEFINITIONS) as ActionId[];
  const wysiwygOnly = ALL.filter(
    (id) => ACTION_DEFINITIONS[id].supports.wysiwyg && !ACTION_DEFINITIONS[id].supports.source,
  ).sort();
  const sourceOnly = ALL.filter(
    (id) => !ACTION_DEFINITIONS[id].supports.wysiwyg && ACTION_DEFINITIONS[id].supports.source,
  ).sort();

  it("the ONLY mode-asymmetric actions are the expected ones (registry-drift guard)", () => {
    // If a new asymmetric action is added, this fails so the mode gates below get
    // extended deliberately rather than silently under-covering.
    expect(wysiwygOnly).toEqual(["toggleQuoteStyle"]);
    expect(sourceOnly).toEqual(["sortLinesAsc", "sortLinesDesc"]);
  });

  it("a non-document (browser) tab refuses AND hides every editing action", () => {
    const browser = ctx({ isDocument: false, editorAvailable: false });
    for (const id of ["bold", "insertTable", "setHeading"] as ActionId[]) {
      expect(isActionExecutable(id, browser)).toBe(false); // executor refuses
      expect(actionAvailability(id, browser)).toBe(false); // palette hides
    }
  });

  it("EVERY WYSIWYG-only action is refused+hidden in Source mode, available in WYSIWYG", () => {
    for (const id of wysiwygOnly) {
      expect(isActionExecutable(id, ctx({ mode: "source" }))).toBe(false);
      expect(actionAvailability(id, ctx({ mode: "source" }))).toBe(false);
      expect(isActionExecutable(id, ctx({ mode: "wysiwyg" }))).toBe(true);
      expect(actionAvailability(id, ctx({ mode: "wysiwyg" }))).toBe(true);
    }
  });

  it("EVERY source-only action is refused+hidden in WYSIWYG mode, available in Source", () => {
    for (const id of sourceOnly) {
      expect(isActionExecutable(id, ctx({ mode: "wysiwyg" }))).toBe(false);
      expect(actionAvailability(id, ctx({ mode: "wysiwyg" }))).toBe(false);
      expect(isActionExecutable(id, ctx({ mode: "source" }))).toBe(true);
      expect(actionAvailability(id, ctx({ mode: "source" }))).toBe(true);
    }
  });

  it("a both-modes action (bold) stays available in both modes (positive control)", () => {
    expect(actionAvailability("bold", ctx({ mode: "wysiwyg" }))).toBe(true);
    expect(actionAvailability("bold", ctx({ mode: "source" }))).toBe(true);
  });

  it("read-only refuses+hides mutating actions but leaves selection/navigation available (both predicates)", () => {
    const ro = ctx({ readOnly: true });
    // Mutating: refused by the executor and hidden from the palette.
    expect(isActionExecutable("bold", ro)).toBe(false);
    expect(actionAvailability("bold", ro)).toBe(false);
    // Non-mutating selection stays executable AND offered under read-only.
    expect(isActionExecutable("selectWord", ro)).toBe(true);
    expect(actionAvailability("selectWord", ro)).toBe(true);
  });

  it("an ordinary editable action is available on a normal document (positive control vs a ()=>false stub)", () => {
    expect(isActionExecutable("bold", ctx())).toBe(true);
    expect(actionAvailability("bold", ctx())).toBe(true);
  });
});
