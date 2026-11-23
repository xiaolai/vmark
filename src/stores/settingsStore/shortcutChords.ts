/**
 * Shortcut chord identity, fixed menu accelerators, and the persisted-binding
 * trust boundary for the shortcuts store.
 *
 * Key decisions:
 *   - Two bindings are "the same key" when the keybinding router would treat
 *     them as the same press: identity is `canonicalizeChordString`, which
 *     resolves `Mod` per platform. Off macOS `Mod-Shift-Up` and `Ctrl-Shift-Up`
 *     are one chord; on macOS `Mod` is Cmd, so `Mod-x` and `Ctrl-x` stay
 *     distinct. A chord the canonicalizer cannot map falls back to the textual
 *     form (lowercase, sorted modifiers), so it still matches its own spellings.
 *   - `FIXED_ACCELERATORS` mirrors `FIXED_ACCELERATOR_IDS` in
 *     `src-tauri/src/menu/accelerators.rs`: menu items whose accelerator is set
 *     in the Rust builder and never follows the shortcut map. Their chords are
 *     taken on the platforms that build them, so no shortcut may claim them.
 *     `shortcutChords.test.ts` reads the Rust sources and fails on drift.
 *   - A binding is reserved when EITHER view of it hits a fixed chord: the
 *     webview identity above, or the native one — the Tauri accelerator the
 *     menu sync sends, read the way muda's parser reads it (trimmed, split on
 *     the last `+`, case-insensitive), so `" F11 "` or `"+F11"` cannot slip a
 *     second F11 menu item past the check.
 *   - A stored binding on a fixed chord (saved before the chord was reserved,
 *     or imported) loses to the fixed item: it becomes `""` (unassigned), the
 *     same outcome the conflict modal gives a displaced owner. It is not
 *     reverted to its default, which another shortcut may have taken since.
 *   - Persisted bindings are untrusted: a non-object map loads as `{}` and a
 *     non-string value is dropped (so the default applies), because a
 *     non-string would otherwise reach the keymap builders and the menu sync.
 *
 * @coordinates-with stores/settingsStore/shortcuts.ts — conflict checks, hydrate, import
 * @coordinates-with hooks/useShortcutsSync.ts — the cross-window route uses the same boundary
 * @coordinates-with src-tauri/src/menu/accelerators.rs — FIXED_ACCELERATOR_IDS
 * @module stores/settingsStore/shortcutChords
 */

import { isMacPlatform } from "@/utils/shortcutMatch";
import { canonicalizeChordString, type Platform } from "@/utils/keybinding/canonicalChord";
import { prosemirrorToTauri } from "./keyFormatting";

/** A menu accelerator fixed in the Rust menu builder, outside the shortcut registry. */
interface FixedAccelerator {
  /** The Rust menu item id (in `FIXED_ACCELERATOR_IDS`). */
  menuId: string;
  /** The chord, in shortcut-store (ProseMirror) form. */
  key: string;
  /** Platforms whose menu builds the item. */
  platforms: readonly Platform[];
}

/** Fixed accelerators; the Rust builder is the source, this is its mirror. */
export const FIXED_ACCELERATORS: readonly FixedAccelerator[] = [
  // View → Toggle Full Screen on Windows/Linux (#1715). macOS uses the
  // predefined Ctrl+Cmd+F item, so F11 stays free there.
  { menuId: "toggle-fullscreen", key: "F11", platforms: ["other"] },
];

function currentPlatform(): Platform {
  return isMacPlatform() ? "mac" : "other";
}

/**
 * Rust `char::is_whitespace` (Unicode White_Space): the set `str::trim` strips.
 * U+0085 (NEL) is in; U+FEFF (BOM/ZWNBSP) is out, so it must NOT be trimmed.
 */
function isRustWhitespace(code: number): boolean {
  return (
    (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/**
 * Trim whitespace the way Rust's `str::trim` does, so the native accelerator
 * reservation can't be slipped past by a control character the JS `trim` leaves
 * in place. A linear scan from each end, never a regex: this runs on untrusted
 * imported/persisted strings, so its cost must stay linear in the input.
 */
function trimRustWhitespace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isRustWhitespace(s.charCodeAt(start))) start++;
  while (end > start && isRustWhitespace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

/** Drop a trailing run of `+`, linear in the run length. */
function stripTrailingPluses(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "+") end--;
  return s.slice(0, end);
}

/** Textual identity for a chord the canonicalizer cannot map. */
function textualIdentity(key: string): string {
  const parts = key.toLowerCase().split("-");
  const modifiers = parts.slice(0, -1).sort();
  return [...modifiers, parts[parts.length - 1]].join("-");
}

/**
 * The identity two bindings share exactly when they are the same key press on
 * `platform`. The `text:` prefix keeps a fallback identity from ever equalling
 * a canonical one.
 */
export function chordIdentity(key: string, platform: Platform = currentPlatform()): string {
  return canonicalizeChordString(key, platform) ?? `text:${textualIdentity(key)}`;
}

/** muda's modifier tokens → one name per platform (`CmdOrCtrl` resolves like `Mod`). */
function nativeModifier(token: string, platform: Platform): string | null {
  switch (trimRustWhitespace(token).toUpperCase()) {
    case "OPTION":
    case "ALT":
      return "alt";
    case "CONTROL":
    case "CTRL":
      return "ctrl";
    case "COMMAND":
    case "CMD":
    case "SUPER":
    case "META":
      return "meta";
    case "SHIFT":
      return "shift";
    case "COMMANDORCONTROL":
    case "COMMANDORCTRL":
    case "CMDORCTRL":
    case "CMDORCONTROL":
      return platform === "mac" ? "meta" : "ctrl";
    default:
      return null;
  }
}

/**
 * The chord the native menu would bind for `key`: its Tauri accelerator split
 * as muda's `split_key_and_modifiers` does. Null when muda would reject it.
 */
function nativeIdentity(key: string, platform: Platform): string | null {
  const accel = trimRustWhitespace(prosemirrorToTauri(key));
  if (!accel) return null;
  const pos = accel.lastIndexOf("+");
  let mods = "";
  let base = accel;
  if (pos >= 0) {
    const raw = accel.slice(pos + 1);
    if (trimRustWhitespace(raw)) {
      mods = accel.slice(0, pos);
      base = trimRustWhitespace(raw);
    } else {
      mods = stripTrailingPluses(accel.slice(0, pos));
      base = "+";
    }
  }
  const resolved = new Set<string>();
  if (mods) {
    for (const token of mods.split("+")) {
      const mod = nativeModifier(token, platform);
      if (!mod) return null;
      resolved.add(mod);
    }
  }
  return [...[...resolved].sort(), base.toUpperCase()].join("+");
}

/** True when `key` is a fixed menu accelerator on `platform`. */
export function isFixedAccelerator(key: string, platform: Platform = currentPlatform()): boolean {
  if (!key) return false;
  const identity = chordIdentity(key, platform);
  const native = nativeIdentity(key, platform);
  return FIXED_ACCELERATORS.some(
    (fixed) =>
      fixed.platforms.includes(platform) &&
      (chordIdentity(fixed.key, platform) === identity ||
        (native !== null && nativeIdentity(fixed.key, platform) === native)),
  );
}

/**
 * Bring an untrusted `customBindings` value to a safe map: a non-object loads
 * as `{}`, non-string values are dropped, and a binding on a fixed accelerator
 * becomes `""` (the fixed item wins).
 */
export function reconcileCustomBindings(
  raw: unknown,
  platform: Platform = currentPlatform(),
): Record<string, string> {
  const clean: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return clean;
  for (const [id, key] of Object.entries(raw)) {
    if (typeof key !== "string") continue;
    clean[id] = isFixedAccelerator(key, platform) ? "" : key;
  }
  return clean;
}
