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
 * Mod-b -> ⌘B (on macOS)
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
  const specialKeys: Record<string, string> = {
    BACKSPACE: "⌫",
    LEFT: "←",
    RIGHT: "→",
    UP: "↑",
    DOWN: "↓",
  };

  const parts = key.split("-");
  const tokens: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "" && i === parts.length - 1) {
      // Trailing empty part: the main key is "-" itself.
      tokens.push("-");
      continue;
    }
    if (part === "") continue;
    const modifier = modifierDisplay[part.toLowerCase()];
    if (modifier !== undefined && i < parts.length - 1) {
      tokens.push(modifier);
      continue;
    }
    const upper = part.toUpperCase();
    tokens.push(specialKeys[upper] ?? upper);
  }

  return tokens.join("");
}
