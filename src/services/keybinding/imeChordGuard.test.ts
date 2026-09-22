/**
 * The IME chord guard — the half of chord consumption that `preventDefault()`
 * on keydown cannot reach.
 *
 * Root cause, recorded live: under a macOS CJK IME the character is committed
 * to the page BEFORE its own keydown is delivered (see the trace note in
 * `components/Terminal/imeAsciiHandoff.test.ts`). So when the toggle-terminal
 * chord `Ctrl+\`` is pressed with Chinese punctuation on, the IME's remapped
 * `·` is already in the document by the time the router matches the chord and
 * calls `preventDefault()` — the panel toggles AND the file goes dirty.
 *
 * The guard vetoes the INSERTION instead, at `beforeinput`, which is the one
 * point that precedes the commit under both event orderings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let isMac = true;
vi.mock("@/utils/shortcutMatch", () => ({ isMacPlatform: () => isMac }));

import { installImeChordGuard, isChordArtifactInsertion } from "./imeChordGuard";

const NONE = { ctrl: false, meta: false, alt: false };

function insertion(over: Partial<Parameters<typeof isChordArtifactInsertion>[0]> = {}) {
  return {
    inputType: "insertText",
    data: "·",
    isComposing: false,
    cancelable: true,
    ...over,
  };
}

describe("isChordArtifactInsertion", () => {
  it("vetoes the IME's `·` while Control is held — the #1083 residue", () => {
    expect(isChordArtifactInsertion(insertion(), { ...NONE, ctrl: true }, "mac")).toBe(true);
  });

  it("vetoes it while Command is held (Mod chords on a symbol key)", () => {
    expect(isChordArtifactInsertion(insertion({ data: "【" }), { ...NONE, meta: true }, "mac")).toBe(
      true,
    );
  });

  it("leaves ordinary typing alone — no command modifier is held", () => {
    expect(isChordArtifactInsertion(insertion({ data: "a" }), NONE, "mac")).toBe(false);
  });

  it("leaves a real composition alone", () => {
    expect(
      isChordArtifactInsertion(insertion({ isComposing: true }), { ...NONE, ctrl: true }, "mac"),
    ).toBe(false);
  });

  it("leaves a paste alone — Command is still held when it lands", () => {
    expect(
      isChordArtifactInsertion(
        insertion({ inputType: "insertFromPaste", data: "hello" }),
        { ...NONE, meta: true },
        "mac",
      ),
    ).toBe(false);
  });

  it("leaves a multi-character insertion alone — an IME rewrite is one glyph", () => {
    expect(
      isChordArtifactInsertion(insertion({ data: "hello" }), { ...NONE, meta: true }, "mac"),
    ).toBe(false);
  });

  it("accepts an astral glyph (one character, two UTF-16 units)", () => {
    expect(
      isChordArtifactInsertion(insertion({ data: "😀" }), { ...NONE, ctrl: true }, "mac"),
    ).toBe(true);
  });

  it("leaves a non-cancelable event alone rather than pretending to veto it", () => {
    expect(
      isChordArtifactInsertion(insertion({ cancelable: false }), { ...NONE, ctrl: true }, "mac"),
    ).toBe(false);
  });

  it("leaves data-less insertions alone", () => {
    expect(isChordArtifactInsertion(insertion({ data: null }), { ...NONE, ctrl: true }, "mac")).toBe(
      false,
    );
  });

  // Option is a TEXT modifier on macOS (Option+e → é) and one half of AltGr on
  // Windows/Linux. Both are excluded, but for opposite reasons and so by
  // different rules — Option alone never reaches here (no ctrl/meta), while
  // AltGr (ctrl+alt) would, and must not be vetoed.
  it("vetoes Option+Command on macOS, where that pair produces no text", () => {
    expect(
      isChordArtifactInsertion(insertion(), { ctrl: false, meta: true, alt: true }, "mac"),
    ).toBe(true);
  });

  it("spares Ctrl+Alt off macOS — that is AltGr, and it types real characters", () => {
    expect(
      isChordArtifactInsertion(insertion({ data: "@" }), { ctrl: true, meta: false, alt: true }, "other"),
    ).toBe(false);
  });

  it("still vetoes plain Ctrl off macOS", () => {
    expect(isChordArtifactInsertion(insertion(), { ...NONE, ctrl: true }, "other")).toBe(true);
  });

  // #1445 — a Windows user could intermittently not type `，`, and switching to
  // another app and back cured it. Off macOS the Super/Windows key is not a
  // command modifier for this app AT ALL: no entry in `shortcutDefinitions.ts`
  // spells `Meta-`/`Cmd-`/`Win-`, and `matchesShortcutEvent`'s non-mac branch
  // never reads `event.metaKey` — it resolves `Mod` to `ctrlKey`. So a veto
  // armed by meta off macOS has no true positive it could ever be catching; it
  // can only swallow text.
  //
  // That matters because `metaKey` is not a fact, it is the OS's belief. A
  // global low-level keyboard hook (the reporter's screenshot points at
  // AltSnap) swallows the Super key's keyup to suppress the Start menu, and
  // every subsequent key event then arrives with `metaKey: true`. The guard
  // re-reads that flag on every event, so the stale belief survives the `blur`
  // reset — which is exactly why only an app switch cleared it.
  //
  // Only symbols broke because only symbols reach here: under a Chinese IME,
  // letters and CJK arrive as composition (exempted above), while a punctuation
  // rewrite like `,`→`，` is committed directly as a one-glyph `insertText`.
  it("spares Meta off macOS — the Super key is not a chord modifier there (#1445)", () => {
    expect(
      isChordArtifactInsertion(insertion({ data: "，" }), { ...NONE, meta: true }, "other"),
    ).toBe(false);
  });

  it("still vetoes Meta on macOS, where it is the Mod key", () => {
    expect(isChordArtifactInsertion(insertion(), { ...NONE, meta: true }, "mac")).toBe(true);
  });

  it("spares Meta+Ctrl off macOS only when Alt is present (AltGr), not otherwise", () => {
    // Ctrl is a real chord modifier off macOS, so a genuine Ctrl chord must
    // still be vetoed even if the Super key is also (believed) down.
    expect(
      isChordArtifactInsertion(insertion(), { ctrl: true, meta: true, alt: false }, "other"),
    ).toBe(true);
  });

  it("leaves Option-only insertions alone (macOS dead keys)", () => {
    expect(isChordArtifactInsertion(insertion({ data: "é" }), { ...NONE, alt: true }, "mac")).toBe(
      false,
    );
  });
});

describe("installImeChordGuard", () => {
  let dispose: (() => void) | null = null;
  let field: HTMLTextAreaElement;

  beforeEach(() => {
    isMac = true;
    field = document.createElement("textarea");
    document.body.appendChild(field);
    dispose = installImeChordGuard(window);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = "";
  });

  function holdControl() {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
  }

  function beforeInput(data: string, over: Partial<InputEventInit> = {}): InputEvent {
    const e = new InputEvent("beforeinput", {
      data,
      inputType: "insertText",
      cancelable: true,
      bubbles: true,
      composed: true,
      ...over,
    });
    field.dispatchEvent(e);
    return e;
  }

  it("cancels the IME commit that a held Control chord produced", () => {
    holdControl();
    expect(beforeInput("·").defaultPrevented).toBe(true);
  });

  it("does not touch ordinary typing", () => {
    expect(beforeInput("a").defaultPrevented).toBe(false);
  });

  it("stops guarding once the modifier is released", () => {
    holdControl();
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", ctrlKey: false, bubbles: true }));
    expect(beforeInput("·").defaultPrevented).toBe(false);
  });

  // Cmd+Tab away mid-chord: the keyup is delivered to the other app, so without
  // a blur reset the guard would swallow the user's next character.
  it("forgets a held modifier when the window loses focus", () => {
    holdControl();
    window.dispatchEvent(new Event("blur"));
    expect(beforeInput("a").defaultPrevented).toBe(false);
  });

  /**
   * The macOS emoji picker (Ctrl+Cmd+Space) is the case that makes this
   * necessary: it is a floating panel, so our window may never see the keyup,
   * and the insertion comes from a CLICK. Stale "ctrl+cmd are down" state would
   * then veto a one-glyph emoji — a user-visible regression the guard would
   * cause rather than fix. A pointer interaction means the chord is over.
   */
  it("forgets a held modifier once the pointer is used", () => {
    holdControl();
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(beforeInput("😀").defaultPrevented).toBe(false);
  });

  it("forgets a held modifier when the document is hidden", () => {
    holdControl();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(beforeInput("a").defaultPrevented).toBe(false);
  });

  /**
   * #1445 — the arming half of the guard is driven by OBSERVED modifier
   * transitions, not by re-reading `event.ctrlKey` off unrelated keys.
   *
   * This replaced a test asserting the opposite ("tracks the modifier from any
   * key event"). That property was chosen to survive a MISSED modifier keydown,
   * but it is also what makes a phantom modifier unrecoverable: `ctrlKey` is
   * the OS's belief, and a global low-level keyboard hook that swallows a
   * modifier's keyup leaves every later event reporting it as held. Re-reading
   * the flag re-arms the guard from the lie, forever.
   *
   * Giving it up costs a stray IME character when a modifier keydown really was
   * missed (window focused mid-chord, synthetic key from a remapper). That is
   * the LOUD failure; swallowing what the user typed is the silent one.
   */
  it("does not arm from a modifier flag it never saw go down", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }));
    expect(beforeInput("·").defaultPrevented).toBe(false);
  });

  /**
   * The bug the three resets LOOKED like they already prevented.
   *
   * Every reset test above dispatches its reset and then a `beforeinput` with
   * no keystroke in between — but in the real failure the user TYPES, and that
   * keydown carried the stale flag and re-armed the guard. So the resets were
   * decorative: they cleared state the next keystroke immediately restored.
   * The reporter's app-switch cure worked because Windows resyncs its own key
   * state on a focus change, not because of this `blur` handler.
   */
  it("keeps a reset even when the OS goes on reporting the modifier as held", () => {
    holdControl();
    window.dispatchEvent(new Event("blur"));
    // The OS is still lying: ctrlKey is true and no Control keydown ever came.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(beforeInput("，").defaultPrevented).toBe(false);
  });

  it("re-arms normally once the modifier is genuinely pressed again", () => {
    holdControl();
    window.dispatchEvent(new Event("blur"));
    holdControl();
    expect(beforeInput("·").defaultPrevented).toBe(true);
  });

  /**
   * Alt is read the OTHER way round, and deliberately: it DISARMS the veto
   * (ctrl+alt is AltGr, which types real characters), so under-detecting it
   * would swallow text. Every uncertainty about Alt resolves toward letting the
   * character through, which is why it is still read straight off the event.
   */
  it("spares AltGr text even though no Alt keydown was observed", () => {
    isMac = false;
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "q", ctrlKey: true, altKey: true, bubbles: true }),
    );
    expect(beforeInput("@").defaultPrevented).toBe(false);
  });

  /**
   * Negative evidence must be read from EVERY keyboard event, including another
   * modifier's. The first draft of the observed-transition model updated the
   * modifier it recognised and returned early, so a Meta keydown reporting
   * `ctrlKey: false` — explicit proof that Control is up — left Control armed,
   * and the next insertion was eaten. HEAD did not have this bug; the rewrite
   * introduced it. (Codex refute pass, objection 1.)
   */
  it("clears a stale modifier on another modifier's event", () => {
    holdControl();
    // Control's keyup is missed, then Command is pressed and released. Both
    // events say ctrlKey:false.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Meta", ctrlKey: false, metaKey: true, bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Meta", ctrlKey: false, metaKey: false, bubbles: true }),
    );
    expect(beforeInput("，").defaultPrevented).toBe(false);
  });

  /**
   * One Boolean stands for both Control keys, so the keyup of the LEFT one
   * cannot mean "Control is up" while the right is still down — the aggregate
   * `ctrlKey` flag is the authority on release. Getting this wrong disarms the
   * guard mid-chord and #1420 leaks again. (Codex refute pass, objection 2.)
   */
  it("stays armed when one of two held Control keys is released", () => {
    holdControl();
    holdControl();
    window.dispatchEvent(
      // Left Control released; the right one is still down, so ctrlKey is TRUE.
      new KeyboardEvent("keyup", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    expect(beforeInput("·").defaultPrevented).toBe(true);
  });

  /**
   * AltGr is Ctrl+Alt on Windows, and the engine NORMALIZES it: for a
   * qualifying printable character it reports `ctrlKey:false, altKey:false` and
   * sets `getModifierState("AltGraph")`. Reading that false flag as "Control was
   * released" would disarm the guard while Control is physically held — and,
   * because arming now needs a fresh keydown that will never come, permanently.
   * (Codex refute pass, objection 3.)
   */
  it("does not read AltGr normalization as a Control release", () => {
    isMac = false;
    holdControl();
    const altGraphKey = new KeyboardEvent("keydown", {
      key: "@",
      ctrlKey: false,
      altKey: false,
      bubbles: true,
    });
    Object.defineProperty(altGraphKey, "getModifierState", {
      value: (m: string) => m === "AltGraph",
    });
    window.dispatchEvent(altGraphKey);
    // Control never went up, so a genuine chord after this must still be caught.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true }));
    expect(beforeInput("·").defaultPrevented).toBe(true);
  });

  /**
   * A pointer interaction means "this INSERTION came from a click", not "the
   * modifier was released" — the emoji picker inserts on a click while Ctrl+Cmd
   * are genuinely still down. Clearing the modifier outright was too blunt once
   * re-arming required a fresh keydown: holding Control, clicking, then
   * continuing to use the keyboard left the chord unprotected for as long as
   * Control stayed down. (Codex refute pass, objection 4.)
   */
  /**
   * A click must RECOVER from a stuck modifier, and that outranks everything
   * else `pointerdown` could do here. An attempt to keep chord protection alive
   * across a click (by recording the gesture instead of clearing) removed this
   * — and it is the recovery the whole of #1445 is about, so it cannot be
   * traded for the loud failure below. (Codex refute pass 2, objection 1.)
   */
  it("recovers from a stuck modifier when the user clicks", () => {
    isMac = false;
    holdControl();
    // The keyup is swallowed, so the OS goes on reporting Control as held.
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(beforeInput("，").defaultPrevented).toBe(false);
  });

  /**
   * The cost of the above, accepted EXPLICITLY rather than discovered later: a
   * modifier genuinely held across a click cannot re-arm until it is pressed
   * again, so the first chord after a Ctrl+click leaks its IME character.
   *
   * This is the loud failure (a stray glyph the user can see and undo) and the
   * alternative is the silent one (text that never appears), so it is the right
   * side to fail on. Pinned so that reversing the trade is a deliberate act.
   * (Codex refute pass 1, objection 4.)
   */
  it("does not protect the first chord after a click, and that is the accepted cost", () => {
    holdControl();
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true, bubbles: true }),
    );
    expect(beforeInput("·").defaultPrevented).toBe(false);
  });

  /**
   * The honest limit, pinned so nobody reads the rest of this file as a claim
   * that stuck modifiers are solved. They are not, and they cannot be from
   * here: a genuinely held modifier and a released one whose keyup was
   * swallowed produce IDENTICAL observations. The browser offers no synchronous
   * truth source at `beforeinput` — `InputEvent` carries neither the modifier
   * flags nor `getModifierState()`.
   *
   * What the change actually buys is RECOVERY. Before it, every reset was
   * undone by the next keystroke, so the state was unrecoverable in-window.
   * Now any click, focus change or tab switch ends it for good. The window of
   * loss is bounded by the user's next click instead of unbounded.
   * (Codex refute pass 3 — the one residual it would not sign off silently.)
   */
  it("still swallows text after a swallowed release, until something resets it", () => {
    isMac = false;
    holdControl();
    // Control is physically released but its keyup never arrives, so the OS
    // goes on reporting ctrlKey:true. Nothing here can tell that from a hold.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(beforeInput("，").defaultPrevented).toBe(true);

    // ...and this is the part that is new: one click ends it permanently.
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(beforeInput("，").defaultPrevented).toBe(false);
  });

  it("forgets a held modifier when the window regains focus", () => {
    // The guard can be installed, or the window re-entered, with a modifier
    // already physically down — a state no event will ever correct.
    holdControl();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(beforeInput("，").defaultPrevented).toBe(false);
  });

  it("stops guarding after disposal", () => {
    holdControl();
    dispose?.();
    dispose = null;
    expect(beforeInput("·").defaultPrevented).toBe(false);
  });
});
