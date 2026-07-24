/**
 * Canonical chord — the single key-identity primitive for the binding registry
 * (ADR-018, keybinding-unification WI-0.1 / WI-1.2).
 *
 * A `CanonicalChord` is a stable string identity for a key combination, derived
 * IDENTICALLY from a definition string (ProseMirror `"Mod-Shift-n"` form) and
 * from a runtime `KeyboardEvent`, so the registry index (built from definitions)
 * and a keypress lookup never diverge.
 *
 * Identity contract (why physical + platform-resolved):
 *   - **Physical key** (`KeyboardEvent.code` names: `KeyN`, `Digit1`, `Minus`,
 *     `F5`, `ArrowUp`, `NumpadEnter`). Physical position is stable across
 *     keyboard layouts AND CJK IMEs (which remap `event.key` but preserve
 *     `event.code`), and it sidesteps dead keys / `event.key === "Dead"` /
 *     `"Process"` / `"Unidentified"` entirely. Shifted symbols need no special
 *     case: `Shift+2` → `shift+Digit2` (shift is just a modifier).
 *   - **Platform-resolved modifiers**: `Mod` → `meta` on macOS, `ctrl` elsewhere.
 *     So on Windows `Mod-n` and `Ctrl-n` both canonicalize to `ctrl+KeyN` (a real
 *     collision, correctly detected), and events match by their actual
 *     `metaKey`/`ctrlKey` state.
 *
 * Numpad keys keep their own identity (`NumpadEnter` ≠ `Enter`). Caps Lock / Fn
 * are never part of a chord. A modifier-only press (`Shift` alone) is not a chord
 * (returns `null`).
 *
 * @module utils/keybinding/canonicalChord
 */

import { isMacPlatform } from "@/utils/shortcutMatch";

export type Platform = "mac" | "other";

/** Opaque canonical identity, e.g. `"meta+shift+KeyN"`, `"ctrl+alt+Minus"`. */
export type CanonicalChord = string;

/** Fixed modifier order so the string form is deterministic. */
const MODIFIER_ORDER = ["meta", "ctrl", "alt", "shift"] as const;

/** Non-alphanumeric definition tokens → their `KeyboardEvent.code` name. */
const TOKEN_TO_CODE: Record<string, string> = {
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  space: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/** `KeyboardEvent.code` values that are modifier keys — never a chord's base. */
const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "Fn",
  "FnLock",
]);

function currentPlatform(): Platform {
  return isMacPlatform() ? "mac" : "other";
}

/** Map one definition key-token (already the base key, not a modifier) to a code. */
function tokenToCode(token: string): string | null {
  const lower = token.toLowerCase();
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (/^[0-9]$/.test(lower)) return `Digit${lower}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
  // Symbols look up by original char first (case matters for none of them, but
  // keep the raw form too), then by lowercased named key.
  return TOKEN_TO_CODE[token] ?? TOKEN_TO_CODE[lower] ?? null;
}

/** Resolve a modifier token to its physical name, honoring `Mod`. */
function resolveModifier(token: string, platform: Platform): string | null {
  switch (token.toLowerCase()) {
    case "mod":
      return platform === "mac" ? "meta" : "ctrl";
    case "cmd":
    case "meta":
    case "super":
      return "meta";
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

function format(mods: Set<string>, code: string): CanonicalChord {
  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...ordered, code].join("+");
}

/**
 * Split a ProseMirror-style definition into modifier tokens + the base key
 * token, handling the `-` separator AND the trailing-minus convention
 * (`Mod--` / `Alt-Mod--` mean the base key IS `-`). Mirrors `keyFormatting.ts`.
 */
function splitDefinition(def: string): { modTokens: string[]; keyToken: string } | null {
  if (!def) return null;
  const parts = def.split("-");
  let keyToken: string;
  let modParts: string[];
  if (parts[parts.length - 1] === "") {
    // Trailing empty part → the base key is `-`; everything before is modifiers.
    keyToken = "-";
    modParts = parts.slice(0, -1).filter((p) => p !== "");
  } else {
    keyToken = parts[parts.length - 1];
    modParts = parts.slice(0, -1).filter((p) => p !== "");
  }
  if (!keyToken) return null;
  return { modTokens: modParts, keyToken };
}

/**
 * Canonicalize a definition string (`"Mod-Shift-n"`, `"Alt-Mod--"`, `"F5"`).
 * Returns `null` if the base key is unrecognized (so callers can reject a
 * malformed binding rather than index a bogus chord).
 */
export function canonicalizeChordString(
  def: string,
  platform: Platform = currentPlatform(),
): CanonicalChord | null {
  const split = splitDefinition(def);
  if (!split) return null;
  const code = tokenToCode(split.keyToken);
  if (!code) return null;
  const mods = new Set<string>();
  for (const token of split.modTokens) {
    const resolved = resolveModifier(token, platform);
    if (!resolved) return null; // unknown modifier → reject
    mods.add(resolved);
  }
  return format(mods, code);
}

/**
 * Canonicalize a live `KeyboardEvent`. Returns `null` for a modifier-only press
 * or an event with no usable `code` (so the router treats it as "not a chord").
 * `platform` is unused for events (the event already carries physical modifier
 * state) but kept in the signature for symmetry/testability.
 */
export function canonicalizeEvent(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
    getModifierState?: (key: string) => boolean;
  },
): CanonicalChord | null {
  const code = event.code;
  if (!code || MODIFIER_CODES.has(code)) return null;
  // AltGr (RightAlt on international/ISO layouts) is reported as ctrl+alt but is a
  // TYPING modifier for composing special characters, never a shortcut chord. Left
  // as-is it would spuriously fire any `Ctrl-Alt-X` binding while the user types
  // (e.g. AltGr+E → `€`). Treat an AltGraph-composited event as non-matching so no
  // binding resolves. `?.` keeps synthetic test events (no getModifierState) working.
  if (event.getModifierState?.("AltGraph")) return null;
  const mods = new Set<string>();
  if (event.metaKey) mods.add("meta");
  if (event.ctrlKey) mods.add("ctrl");
  if (event.altKey) mods.add("alt");
  if (event.shiftKey) mods.add("shift");
  return format(mods, code);
}
