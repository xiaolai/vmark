/**
 * Turn a physical key event into a ProseMirror-format chord string
 * (WI-TNAV2.3).
 *
 * Extracted from `KeyCapture.tsx` so the mapping is testable without mounting a
 * modal that listens on `window` — the test matrix specified it as its own unit
 * for exactly that reason.
 *
 * @coordinates-with pages/settings/KeyCapture.tsx — the only caller
 * @coordinates-with utils/keybinding/canonicalChord.ts — where the result is resolved
 * @module pages/settings/captureChord
 */
import { isMacPlatform } from "@/utils/platform";

/** Modifier-only presses that must never become a chord on their own. */
const LONE_MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta"]);

const SPECIAL_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

export interface ChordEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The chord for this event, or `null` for a lone modifier.
 *
 * **`Mod` is Cmd on macOS and Ctrl everywhere else.** Collapsing BOTH physical
 * keys into `Mod` — which this did until WI-TNAV2.3 — made a literal Ctrl chord
 * uncapturable on macOS: pressing Ctrl+Tab produced `Mod-Tab`, i.e. Cmd+Tab. So
 * every shipped `Ctrl-…` default (the sidebar panel family, the transform trio,
 * Last Used Tab) was impossible to re-enter once changed. Off macOS the
 * collapse is correct, because there `Mod` genuinely is Ctrl.
 */
export function captureChord(e: ChordEventLike, mac: boolean = isMacPlatform()): string | null {
  if (LONE_MODIFIERS.has(e.key)) return null;

  const parts: string[] = [];
  if (mac) {
    if (e.metaKey) parts.push("Mod");
    if (e.ctrlKey) parts.push("Ctrl");
  } else if (e.ctrlKey || e.metaKey) {
    parts.push("Mod");
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  let key = SPECIAL_KEYS[e.key] ?? e.key;
  if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join("-");
}
