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

  it("tracks the modifier from any key event, not only the modifier's own keydown", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }));
    expect(beforeInput("·").defaultPrevented).toBe(true);
  });

  it("stops guarding after disposal", () => {
    holdControl();
    dispose?.();
    dispose = null;
    expect(beforeInput("·").defaultPrevented).toBe(false);
  });
});
