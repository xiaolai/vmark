/**
 * IME chord guard — the half of chord consumption that `preventDefault()` on
 * keydown cannot reach.
 *
 * **The ordering is the bug.** Under a macOS CJK input method the character is
 * committed to the page BEFORE its own keydown is delivered — recorded from a
 * live Shuangpin trace and pinned in
 * `components/Terminal/imeAsciiHandoff.test.ts`. So for `Ctrl+\`` (Toggle
 * Terminal) with Chinese punctuation on, the IME's remapped `·` is already in
 * the document by the time `useKeybindingRouter` matches the chord and calls
 * `preventDefault()`: the panel toggles AND the file goes dirty, and the
 * `preventDefault()` that was supposed to stop it is a no-op. The same
 * ordering put `·` into the shell from the terminal side, past a handler whose
 * comment claims to consume it.
 *
 * `utils/shortcutMatch.ts` already resolves such a keypress to its PHYSICAL key
 * (`·` → `Backquote`), which is why the shortcut FIRES under an IME at all
 * (#1083). This module is the other half: the keystroke must also insert
 * nothing.
 *
 * **The rule, and why it is safe.** Veto a single-glyph `insertText` while a
 * COMMAND modifier is held. Every Ctrl/Cmd chord in this app runs a command;
 * none of them means "type this character", so an insertion arriving under one
 * is an input-method artifact by construction. Narrowness is doing the work:
 *   - `insertText` only — a paste is `insertFromPaste` and lands with Cmd still
 *     held, so inputType is what separates them.
 *   - not `isComposing`, and composition commits are `insertCompositionText`
 *     (non-cancelable) — real CJK typing is never touched.
 *   - one glyph — an IME punctuation rewrite is one character.
 *   - Option is excluded on each platform for its OWN reason: on macOS it is a
 *     text modifier (Option+e → é) and never appears here, since a veto needs
 *     ctrl or meta; off macOS `ctrl+alt` IS AltGr, which types real characters
 *     on European layouts, so that pair is spared explicitly. On macOS
 *     Option+Command produces no text and is therefore still vetoed.
 *
 * It runs at `beforeinput` in the CAPTURE phase on the window, which precedes
 * the commit under BOTH event orderings — so it is correct whether or not a
 * given IME delivers the insert before the keydown, and it covers ProseMirror,
 * CodeMirror and xterm's helper textarea in one place (all three let the
 * browser perform the insertion; canceling it means no DOM mutation for
 * ProseMirror to observe, and no `input` event for the terminal's IME gate to
 * forward to the PTY).
 *
 * @coordinates-with hooks/useKeybindingRouter.ts — installs it beside the keydown adapter
 * @coordinates-with utils/shortcutMatch.ts — resolves the same keypress to its physical key
 * @module services/keybinding/imeChordGuard
 */

import { isMacPlatform } from "@/utils/shortcutMatch";

/** Which command modifiers are physically held right now. */
export interface ChordModifierState {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

/** The fields of an `InputEvent` the decision reads. */
export interface InsertionFacts {
  inputType: string;
  data: string | null;
  isComposing: boolean;
  cancelable: boolean;
}

const NO_MODIFIERS: ChordModifierState = { ctrl: false, meta: false, alt: false };

/** One glyph — an astral character is two UTF-16 units and still one glyph. */
const MAX_ARTIFACT_LENGTH = 2;

/**
 * Whether this insertion is an input method's rendering of a COMMAND chord
 * rather than text the user meant to type. Pure — the installer supplies the
 * modifier state and the platform.
 */
export function isChordArtifactInsertion(
  event: InsertionFacts,
  held: ChordModifierState,
  platform: "mac" | "other",
): boolean {
  if (!event.cancelable) return false;
  if (event.isComposing) return false;
  if (event.inputType !== "insertText") return false;
  if (!event.data || event.data.length > MAX_ARTIFACT_LENGTH) return false;
  if (!held.ctrl && !held.meta) return false;
  // AltGr is ctrl+alt off macOS, and it types real characters.
  if (platform !== "mac" && held.alt) return false;
  return true;
}

/**
 * Install the guard on a window. Returns a disposer.
 *
 * Modifier state is read off EVERY keyboard event rather than tracked from the
 * modifier's own keydown: `event.ctrlKey` is already false on Control's keyup,
 * so one assignment both sets and clears, and a missed modifier keydown is
 * corrected by the next key event instead of latching.
 *
 * Three events clear it outright, because each is a way for the keyup to never
 * arrive — and STALE "a modifier is down" state is the one way this guard could
 * eat text the user meant. `blur`: Cmd+Tab delivers the keyup to the other app.
 * `pointerdown`: the macOS emoji picker opens on Ctrl+Cmd+Space as a floating
 * panel and inserts on a CLICK, so without this the guard would veto a
 * one-glyph emoji. `visibilitychange`: the same hole via a workspace switch.
 */
export function installImeChordGuard(target: Window): () => void {
  let held: ChordModifierState = NO_MODIFIERS;

  const track = (event: Event): void => {
    const e = event as KeyboardEvent;
    held = { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
  };
  const clear = (): void => {
    held = NO_MODIFIERS;
  };
  const onBeforeInput = (event: Event): void => {
    const e = event as InputEvent;
    const facts: InsertionFacts = {
      inputType: e.inputType,
      data: e.data,
      isComposing: e.isComposing,
      cancelable: e.cancelable,
    };
    if (!isChordArtifactInsertion(facts, held, isMacPlatform() ? "mac" : "other")) return;
    e.preventDefault();
  };

  target.addEventListener("keydown", track, true);
  target.addEventListener("keyup", track, true);
  target.addEventListener("blur", clear);
  target.addEventListener("pointerdown", clear, true);
  target.document.addEventListener("visibilitychange", clear);
  target.addEventListener("beforeinput", onBeforeInput, true);

  return () => {
    target.removeEventListener("keydown", track, true);
    target.removeEventListener("keyup", track, true);
    target.removeEventListener("blur", clear);
    target.removeEventListener("pointerdown", clear, true);
    target.document.removeEventListener("visibilitychange", clear);
    target.removeEventListener("beforeinput", onBeforeInput, true);
  };
}
