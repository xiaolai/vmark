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
 *   - **"Command modifier" is per-platform, and Super is not one off macOS.**
 *     `Mod` resolves to Ctrl there, no shortcut spells `Meta-`, and
 *     `matchesShortcutEvent`'s non-mac branch never reads `metaKey` — so a veto
 *     armed by meta off macOS has no true positive it could be catching. It
 *     shipped arming on either modifier on every platform and cost a Windows
 *     user the ability to type `，` (#1445).
 *
 * **A modifier flag is the OS's belief, not a fact, and a stale one is this
 * guard's worst failure.** A global low-level keyboard hook (AltSnap, and
 * anything else that swallows Super's keyup to suppress the Start menu) leaves
 * every later key event reporting `metaKey: true`. Because the state is re-read
 * from each event, the `blur` reset below is undone by the very next keystroke
 * — which is why the reporter's only cure was switching apps. Narrowing the
 * arming set is what removes that path off macOS; on macOS Cmd is load-bearing
 * and the risk is accepted. Keep the arming set as small as each platform's
 * real chord vocabulary, because everything else here fails SILENTLY: the
 * character simply never appears.
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
  // Which modifiers mean "command" on THIS platform. Off macOS the Super key is
  // not one of them, so it must not arm the veto (#1445).
  const commandHeld = platform === "mac" ? held.ctrl || held.meta : held.ctrl;
  if (!commandHeld) return false;
  // AltGr is ctrl+alt off macOS, and it types real characters.
  if (platform !== "mac" && held.alt) return false;
  return true;
}

/** `KeyboardEvent.key` values for the two modifiers that ARM the veto. */
const COMMAND_MODIFIER_KEYS: Readonly<Record<string, "ctrl" | "meta">> = {
  Control: "ctrl",
  Meta: "meta",
  // What older engines call the Super/Windows key.
  OS: "meta",
};

/**
 * Install the guard on a window. Returns a disposer.
 *
 * **An arming modifier counts only once we have SEEN its own keydown.** It used
 * to be re-read from `event.ctrlKey` on every keyboard event, so that a missed
 * modifier keydown would be corrected by the next key rather than latching.
 * That is the wrong trade, because the flag is the OS's belief: a swallowed
 * keyup makes every later event report the modifier as held, and re-reading the
 * flag re-arms the guard from the lie on the very next keystroke. It made the
 * resets below decorative — they cleared state that typing immediately restored
 * (#1445). Arming from an observed transition is what lets a reset hold.
 *
 * The price is a missed modifier keydown (window entered mid-chord, a synthetic
 * key from a remapper) leaving a stray IME character in the document. That is
 * the loud failure, and this guard's alternative is the silent one — a
 * character the user typed that simply never appears.
 *
 * Evidence is read ASYMMETRICALLY, and each direction has a reason:
 *   - a flag reading UP disarms immediately, from any keyboard event, because
 *     the real keyup may never be delivered. The AGGREGATE flag is the
 *     authority on release — the left Control's keyup still reports
 *     `ctrlKey: true` while the right one is held, so it must not disarm.
 *   - a flag reading DOWN arms nothing. Only the modifier's own keydown does.
 *   - `AltGraph` is neither: the engine reports a normalized AltGr character
 *     with `ctrlKey: false` while Control is physically down, so reading that
 *     as a release would disarm the guard for as long as Control stayed held.
 *
 * Four events clear it outright, because each is a way for the keyup to never
 * arrive — and STALE "a modifier is down" state is the one way this guard could
 * eat text the user meant. `blur`: Cmd+Tab delivers the keyup to the other app.
 * `focus`: the window can be entered with a modifier already down, which no
 * later event corrects. `visibilitychange`: the same hole via a workspace
 * switch.
 *
 * `pointerdown` is the fourth, and carries the most weight of them: a click
 * is the user's fastest way out of a stuck modifier, and recovering from one is
 * what #1445 is about. It also covers the macOS emoji picker, which opens on
 * Ctrl+Cmd+Space as a floating panel and inserts on a CLICK with both modifiers
 * genuinely still down.
 *
 * Recording the click as a "gesture" instead — so that chord protection could
 * survive it — was tried and REVERTED: it kept protection alive at the cost of
 * the recovery, which is the wrong side of the trade. What that costs is the
 * first chord after a Ctrl+click, which leaks its IME character until the
 * modifier is pressed again. That failure is loud and this one is silent, so
 * the loud one wins. Both directions are pinned by tests.
 */
export function installImeChordGuard(target: Window): () => void {
  /**
   * Command modifiers we have SEEN go down and not come back up. Set only by
   * the modifier key's OWN keydown — never inferred from `event.ctrlKey` on an
   * unrelated key, which is the lie described in the header.
   */
  let armed = { ctrl: false, meta: false };
  /** Alt, read straight off the event — it only ever disarms. See below. */
  let altHeld = false;

  const track = (event: Event): void => {
    const e = event as KeyboardEvent;
    // AltGr is Ctrl+Alt on Windows, and the engine NORMALIZES it: for a
    // qualifying printable character it reports ctrlKey:false and altKey:false
    // and sets this instead. Count it as Alt, because Alt only ever DISARMS —
    // and treat it as proof of nothing about Control below.
    const altGraph = e.getModifierState?.("AltGraph") === true;
    // Alt is read LIBERALLY and the asymmetry is deliberate: ctrl/meta arm the
    // veto, alt (as AltGr) cancels it. Under-detecting an arming modifier
    // inserts a character; under-detecting alt SWALLOWS one. Every uncertainty
    // has to resolve toward the character appearing.
    altHeld = e.altKey || altGraph;

    // NEGATIVE evidence, taken from EVERY keyboard event — including another
    // modifier's own, which is where the first draft of this leaked: it updated
    // the modifier it recognised and returned, so a Meta keydown reporting
    // ctrlKey:false left a stale Control armed.
    //
    // The AGGREGATE flag is the authority on release, which is what makes the
    // two-Control case right: the left key's keyup still reports ctrlKey:true
    // while the right one is down, so it must not disarm.
    if (!e.ctrlKey && !altGraph) armed = { ...armed, ctrl: false };
    if (!e.metaKey) armed = { ...armed, meta: false };

    // POSITIVE evidence: only a command modifier's OWN keydown arms the veto. A
    // flag that reads DOWN on any other key is corroboration, not evidence —
    // that distinction is the whole of #1445.
    if (e.type === "keydown") {
      const slot = COMMAND_MODIFIER_KEYS[e.key];
      if (slot) armed = { ...armed, [slot]: true };
    }
  };
  const clear = (): void => {
    armed = { ctrl: false, meta: false };
    altHeld = false;
  };
  const onBeforeInput = (event: Event): void => {
    const e = event as InputEvent;
    const facts: InsertionFacts = {
      inputType: e.inputType,
      data: e.data,
      isComposing: e.isComposing,
      cancelable: e.cancelable,
    };
    const held: ChordModifierState = { ctrl: armed.ctrl, meta: armed.meta, alt: altHeld };
    if (!isChordArtifactInsertion(facts, held, isMacPlatform() ? "mac" : "other")) return;
    e.preventDefault();
  };

  target.addEventListener("keydown", track, true);
  target.addEventListener("keyup", track, true);
  target.addEventListener("blur", clear);
  // `focus` too, not just `blur`: the window can be ENTERED with a modifier
  // already physically down (or the guard installed then), a state no later
  // event corrects. Requiring a fresh keydown after every focus change is what
  // makes "switch away and back" a structural cure rather than a coincidence.
  target.addEventListener("focus", clear);
  target.addEventListener("pointerdown", clear, true);
  target.document.addEventListener("visibilitychange", clear);
  target.addEventListener("beforeinput", onBeforeInput, true);

  return () => {
    target.removeEventListener("keydown", track, true);
    target.removeEventListener("keyup", track, true);
    target.removeEventListener("blur", clear);
    target.removeEventListener("focus", clear);
    target.removeEventListener("pointerdown", clear, true);
    target.document.removeEventListener("visibilitychange", clear);
    target.removeEventListener("beforeinput", onBeforeInput, true);
  };
}
