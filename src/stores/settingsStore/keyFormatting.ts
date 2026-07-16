/**
 * Key formatting helpers — pure conversions between ProseMirror key
 * strings, Tauri accelerator strings, and user-facing display strings.
 * Extracted from `shortcuts.ts` (no store dependencies).
 *
 * @module stores/settingsStore/keyFormatting
 */

import { isMacPlatform } from "@/utils/shortcutMatch";

/**
 * Convert ProseMirror key format to Tauri accelerator format.
 * Mod-b -> CmdOrCtrl+B
 * Mod-Shift-` -> CmdOrCtrl+Shift+`
 */
/** @internal Exported for testing */
export function prosemirrorToTauri(key: string): string {
  if (!key) return "";

  const modifierNames = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
  const modifierMap: Record<string, string> = { Mod: "CmdOrCtrl" };

  const parts = key.split("-");
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "" && i === parts.length - 1) {
      result.push("-");
    } else if (part === "") {
      continue;
    } else if (modifierNames.has(part) && i < parts.length - 1) {
      result.push(modifierMap[part] ?? part);
    } else {
      const mapped = modifierMap[part] ?? part;
      if (mapped.length === 1 && /[a-z]/i.test(mapped)) {
        result.push(mapped.toUpperCase());
      } else {
        result.push(mapped);
      }
    }
  }

  return result.join("+");
}

/**
 * Format key for display (user-friendly).
 * Mod-b -> ⌘B (on macOS), Ctrl+B (on Windows/Linux)
 *
 * Platform-specific rendering:
 *   - macOS: symbol glyphs joined with no separator, in authored order (⌘⇧B).
 *   - Windows/Linux: word modifiers joined with "+", normalized to the
 *     conventional Ctrl → Alt → Shift → key order regardless of how the
 *     shortcut was authored (#1113). Without this the context menu rendered
 *     "CtrlShiftX" (no separators) in a non-standard modifier order.
 *
 * Token-aware: `-` is the separator, but a trailing empty part means the
 * main key IS the minus key (e.g. `Mod--` for zoomOut, `Alt-Mod--` for
 * horizontalLine) and must be preserved in the display string.
 */
export function formatKeyForDisplay(key: string): string {
  if (!key) return "";
  const isMac = isMacPlatform();

  const modifierDisplay: Record<string, string> = {
    mod: isMac ? "⌘" : "Ctrl",
    ctrl: isMac ? "⌃" : "Ctrl",
    alt: isMac ? "⌥" : "Alt",
    shift: isMac ? "⇧" : "Shift",
  };
  // Canonical modifier precedence for Windows/Linux display: Ctrl → Alt → Shift.
  const modifierRank: Record<string, number> = { mod: 0, ctrl: 0, alt: 1, shift: 2 };
  const specialKeys: Record<string, string> = {
    BACKSPACE: "⌫",
    LEFT: "←",
    RIGHT: "→",
    UP: "↑",
    DOWN: "↓",
  };

  const parts = key.split("-");
  const modifiers: { rank: number; label: string }[] = [];
  let mainKey = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "" && i === parts.length - 1) {
      // Trailing empty part: the main key is "-" itself.
      mainKey = "-";
      continue;
    }
    if (part === "") continue;
    const lower = part.toLowerCase();
    const modifier = modifierDisplay[lower];
    if (modifier !== undefined && i < parts.length - 1) {
      modifiers.push({ rank: modifierRank[lower], label: modifier });
      continue;
    }
    const upper = part.toUpperCase();
    mainKey = specialKeys[upper] ?? upper;
  }

  if (isMac) {
    // Preserve authored order and glyph-only rendering (macOS is primary).
    return [...modifiers.map((m) => m.label), mainKey].join("");
  }
  const ordered = [...modifiers].sort((a, b) => a.rank - b.rank).map((m) => m.label);
  return [...ordered, mainKey].join("+");
}
