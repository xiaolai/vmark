/**
 * Keyboard Shortcut Matching
 *
 * Purpose: Matches keyboard events against shortcut definitions in the
 * "Mod-Shift-n" format used by shortcutsStore.ts.
 *
 * Key decisions:
 *   - "Mod" maps to Cmd on macOS, Ctrl elsewhere (platform-aware)
 *   - Physical key code fallback (SYMBOL_KEY_TO_CODE) handles CJK IME remapping
 *     where event.key reports the remapped character instead of the physical key
 *   - Shifted symbol matching (e.g., Shift+= produces +) for correct detection
 *   - Ctrl+letter on macOS produces control characters — falls back to event.code
 *
 * @coordinates-with shortcutsStore.ts — provides shortcut definitions in "Mod-Shift-n" format
 * @coordinates-with menu.rs — Rust accelerators use different format but same logical bindings
 * @module utils/shortcutMatch
 */

export type ShortcutPlatform = "mac" | "other";

// Physical key codes for symbol keys commonly remapped by CJK input methods.
// When a Chinese/Japanese/Korean IME is active, event.key may report the
// remapped character (e.g., ` → ·, [ → 【) but event.code always reflects
// the physical key position.
const SYMBOL_KEY_TO_CODE: Record<string, string> = {
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "=": "Equal",
};

const KEY_ALIASES: Record<string, string> = {
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  esc: "escape",
  escape: "escape",
  return: "enter",
};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

function normalizeKeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  return KEY_ALIASES[normalized] ?? normalized;
}

function normalizeEventKey(key: string): string {
  return normalizeKeyToken(key);
}

function matchesShiftedSymbol(event: KeyboardEvent, token: string): boolean {
  if (!event.shiftKey) return false;
  const normalized = normalizeKeyToken(token);
  if (normalized === "/" && event.key === "?") return true;
  if (normalized === "=" && event.key === "+") return true;
  if (normalized === "-" && event.key === "_") return true;
  if (normalized === "." && event.key === ">") return true;
  return false;
}

export function matchesShortcutEvent(
  event: KeyboardEvent,
  shortcut: string,
  platform: ShortcutPlatform = isMacPlatform() ? "mac" : "other"
): boolean {
  if (!shortcut) return false;

  const parts = shortcut.split("-").filter(Boolean);
  if (parts.length === 0) return false;

  const keyToken = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));

  const wantsMod = modifiers.has("mod");
  const wantsCtrl = modifiers.has("ctrl");
  const wantsAlt = modifiers.has("alt");
  const wantsShift = modifiers.has("shift");

  const modPressed = platform === "mac" ? event.metaKey : event.ctrlKey;

  if (wantsMod) {
    if (!modPressed) return false;
  } else if (platform === "mac" && modPressed) {
    return false;
  }

  if (platform === "mac") {
    if (wantsCtrl !== event.ctrlKey) return false;
  } else {
    const ctrlRequired = wantsCtrl || wantsMod;
    if (ctrlRequired !== event.ctrlKey) return false;
  }
  if (wantsAlt !== event.altKey) return false;
  if (wantsShift !== event.shiftKey) return false;

  const targetKey = normalizeKeyToken(keyToken);
  if (matchesShiftedSymbol(event, keyToken)) return true;

  const eventKey = normalizeEventKey(event.key);
  if (eventKey === targetKey) return true;

  // Fallback: match physical key via event.code when CJK IMEs remap the character
  const expectedCode = SYMBOL_KEY_TO_CODE[targetKey];
  if (expectedCode && event.code === expectedCode) return true;

  // Fallback: Ctrl+letter on macOS produces control characters (e.g., Ctrl+B → \x02)
  // instead of the letter — match via event.code in that case
  if (event.ctrlKey && /^[a-z0-9]$/.test(targetKey)) {
    const letter = targetKey.toUpperCase();
    const expected = targetKey >= "0" && targetKey <= "9" ? `Digit${letter}` : `Key${letter}`;
    if (event.code === expected) return true;
  }

  return false;
}
