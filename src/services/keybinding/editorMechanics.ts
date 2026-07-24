/**
 * Editor mechanics — the classification allowlist + gate (ADR-018, WI-4.1).
 *
 * An "editor mechanic" is a hardcoded keybinding in the WYSIWYG/Source editor
 * keymaps that is NOT a user-facing command: it has no configurable shortcut, no
 * menu item, and no CommandBus command. Mechanics are structural editing
 * behaviours (autopair, caret movement, list continuation, table navigation,
 * mark-boundary escape) that must stay in the editor adapter, not route through
 * the bus — routing them would expose them to rebinding/palette discovery they
 * were never meant to have.
 *
 * This module is the single source of truth for which behaviours are approved
 * mechanics. The gate (`validateMechanicClassification`) rejects a "mechanic"
 * that collides with a registered command, a configurable shortcut, or a menu
 * id — i.e. anything that is really a command masquerading as a mechanic — and
 * rejects duplicate ids or a missing rationale. It runs in the test suite
 * against the REAL CommandBus + shortcut registries.
 *
 * @coordinates-with services/commands/CommandBus.ts — registered command ids
 * @coordinates-with stores/settingsStore/shortcutDefinitions.ts — shortcut/menu ids
 * @module services/keybinding/editorMechanics
 */

/** One structural editing behaviour that is deliberately NOT a command. */
export interface EditorMechanic {
  /** Stable, namespaced id (`<surface>.<name>`). Never a command/shortcut id. */
  id: string;
  /** Editor surface(s) the mechanic lives on. */
  surface: "source" | "wysiwyg" | "both";
  /** The chord(s) it occupies — informational, for conflict review. */
  keys: readonly string[];
  /** Why it is a mechanic and not a configurable command. Required, non-empty. */
  rationale: string;
}

/**
 * The approved editor mechanics. Adding a row here is a deliberate declaration
 * that a chord is structural and must never become a rebindable command. The
 * gate keeps the declaration honest.
 */
export const APPROVED_MECHANICS: readonly EditorMechanic[] = [
  // ── Source (CodeMirror) — sourceEditorKeymap.ts precedence keymap ──
  {
    id: "source.visualLineMotion",
    surface: "source",
    keys: ["ArrowUp", "ArrowDown", "Shift-ArrowUp", "Shift-ArrowDown"],
    rationale: "Caret movement over visually-wrapped lines; pure navigation.",
  },
  {
    id: "source.smartHome",
    surface: "source",
    keys: ["Home", "Shift-Home"],
    rationale: "Home toggles between first-non-whitespace and line start.",
  },
  {
    id: "source.structuralBackspace",
    surface: "source",
    keys: ["Backspace", "Delete"],
    rationale: "Protects table pipes / list & blockquote markers from deletion.",
  },
  {
    id: "source.listContinuation",
    surface: "source",
    keys: ["Enter"],
    rationale: "Continues the list/quote prefix on a new line.",
  },
  {
    id: "source.tableNav",
    surface: "source",
    keys: ["Tab", "Shift-Tab", "Mod-Enter", "Mod-Shift-Enter"],
    rationale: "Tab/arrow/row navigation inside a Markdown table.",
  },
  {
    id: "source.listSmartIndent",
    surface: "source",
    keys: ["Tab", "Shift-Tab"],
    rationale: "Tab indents/outdents a list item instead of inserting a tab.",
  },
  {
    id: "source.autoPairBackspace",
    surface: "source",
    keys: ["Backspace"],
    rationale: "Backspace deletes both halves of an auto-paired bracket/quote.",
  },
  {
    id: "source.bracketEscape",
    surface: "source",
    keys: ["Tab"],
    rationale: "Tab skips over a closing bracket the editor auto-inserted.",
  },
  {
    id: "source.autoPair",
    surface: "source",
    keys: ["(", "[", "{", '"', "'", "`"],
    rationale: "CodeMirror closeBrackets — inserts the matching close char.",
  },
  {
    id: "source.tabIndentFallback",
    surface: "source",
    keys: ["Tab", "Shift-Tab"],
    rationale: "Fallback Tab inserts/removes indentation when no rule matched.",
  },
  // ── Both editors — selection mechanics ──
  {
    id: "both.smartSelectAll",
    surface: "both",
    keys: ["Mod-a"],
    rationale:
      "Progressive select-all (block → document); a containment guard, not a rebindable command.",
  },
  {
    id: "both.selectionUndo",
    surface: "both",
    keys: ["Mod-z"],
    rationale:
      "Restores the prior selection before the smart select-all, then falls through to real undo.",
  },
  // ── WYSIWYG (ProseMirror/Tiptap) ──
  {
    id: "wysiwyg.escape",
    surface: "wysiwyg",
    keys: ["Escape"],
    rationale:
      "Closes source-peek / toolbar, collapses a non-empty selection, or escapes a mark boundary.",
  },
  {
    id: "wysiwyg.taskSplit",
    surface: "wysiwyg",
    keys: ["Enter"],
    rationale: "Splits the current task list item onto a new line.",
  },
  {
    id: "wysiwyg.aiSuggestionAccept",
    surface: "wysiwyg",
    keys: ["Enter"],
    rationale: "Accepts a pending inline AI suggestion when one is showing.",
  },
  {
    id: "wysiwyg.mediaNodeNav",
    surface: "wysiwyg",
    keys: ["Enter", "ArrowUp", "ArrowDown"],
    rationale: "Caret escape / paragraph insertion around a selected media node.",
  },
  {
    id: "wysiwyg.listBackspace",
    surface: "wysiwyg",
    keys: ["Backspace"],
    rationale: "Lifts an empty list item out instead of merging it upward.",
  },
  {
    id: "wysiwyg.tableRowKeys",
    surface: "wysiwyg",
    keys: ["Shift-Tab", "Mod-Enter", "Mod-Shift-Enter"],
    rationale: "Row add / cell navigation inside a WYSIWYG table.",
  },
  {
    id: "wysiwyg.multiCursorEscape",
    surface: "wysiwyg",
    keys: ["Escape"],
    rationale: "Collapses multiple selections back to a single cursor.",
  },
] as const;

/** The approved mechanic ids as a set (built once). */
export const APPROVED_MECHANIC_IDS: ReadonlySet<string> = new Set(
  APPROVED_MECHANICS.map((m) => m.id),
);

/** Registries the gate checks the mechanic allowlist against. */
export interface MechanicClassificationInput {
  /** Every registered CommandBus command id. */
  commandIds: ReadonlySet<string>;
  /** Every configurable shortcut id (`shortcutDefinitions.ts`). */
  shortcutIds: ReadonlySet<string>;
  /** Every menu id declared on a shortcut definition. */
  menuIds: ReadonlySet<string>;
}

/**
 * Validate the mechanic allowlist against the live command/shortcut registries.
 * Returns a list of human-readable violations (empty ⇒ the classification is
 * clean). A mechanic is REJECTED when it:
 *   - duplicates another mechanic id,
 *   - has an empty rationale,
 *   - collides with a registered command id,
 *   - collides with a configurable shortcut id, or
 *   - collides with a menu id
 * — i.e. anything that is really a command must not be declared a mechanic.
 */
export function validateMechanicClassification(
  input: MechanicClassificationInput,
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const mechanic of APPROVED_MECHANICS) {
    const { id } = mechanic;

    if (seen.has(id)) {
      violations.push(`Duplicate mechanic id "${id}".`);
    }
    seen.add(id);

    if (!mechanic.rationale.trim()) {
      violations.push(`Mechanic "${id}" has an empty rationale.`);
    }
    if (input.commandIds.has(id)) {
      violations.push(`Mechanic "${id}" collides with a registered command id.`);
    }
    if (input.shortcutIds.has(id)) {
      violations.push(`Mechanic "${id}" collides with a configurable shortcut id.`);
    }
    if (input.menuIds.has(id)) {
      violations.push(`Mechanic "${id}" collides with a menu id.`);
    }
  }

  return violations;
}
