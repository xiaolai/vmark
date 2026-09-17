/**
 * The IME chord guard, measured in REAL WebKit — the engine that ships.
 *
 * The jsdom suite proves the DECISION (which insertions count as a command
 * chord's artifact). It cannot prove the thing the whole fix rests on, because
 * jsdom performs no editing: that **canceling `beforeinput` actually stops the
 * character from reaching the document**. Two engine facts are load-bearing and
 * both are asserted here rather than assumed:
 *
 *   1. `beforeinput` for `insertText` is CANCELABLE in WebKit. If it ever
 *      stopped being, the guard would silently become a no-op and the `·`
 *      would come back with every unit test still green.
 *   2. ProseMirror honours the cancellation. It has no `insertText` handler of
 *      its own — it reads the DOM the browser mutated — so a canceled insert
 *      leaves nothing to observe. That is a property of the pair, not of
 *      either half, which is why it is asserted against a real editor.
 *
 * `execCommand("insertText")` is the probe because it enters WebKit's editing
 * pipeline at the same place an input method's direct (non-composition)
 * insertion does — which is what a CJK IME performs when it rewrites the
 * backquote key to `·`. What no automated tier can produce is the real IME's
 * event ORDERING (the insert arriving before its own keydown); that is the
 * opt-in `pnpm e2e:ime` lane, which carries the chord case.
 *
 * @coordinates-with services/keybinding/imeChordGuard.ts — the module under test
 * @coordinates-with e2e/run-ime.mjs — the real-input-method lane
 * @module services/keybinding/imeChordGuard.webkit.test
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { installImeChordGuard } from "./imeChordGuard";

const flush = () => new Promise((r) => setTimeout(r, 20));

/** What a CJK IME emits for the backquote key with Chinese punctuation on. */
const IME_BACKQUOTE = "·";

let dispose: (() => void) | null = null;

function holdControl(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
  );
}

function releaseControl(): void {
  window.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Control", ctrlKey: false, bubbles: true }),
  );
}

beforeEach(() => {
  dispose = installImeChordGuard(window);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  releaseControl();
  document.body.innerHTML = "";
});

describe("engine facts the guard depends on", () => {
  it("dispatches a CANCELABLE beforeinput for insertText", async () => {
    const host = document.createElement("div");
    host.contentEditable = "true";
    document.body.appendChild(host);
    host.focus();

    let seen: InputEvent | null = null;
    host.addEventListener("beforeinput", (e) => {
      seen = e as InputEvent;
    });
    document.execCommand("insertText", false, "x");
    await flush();

    expect(seen).not.toBeNull();
    expect(seen!.inputType).toBe("insertText");
    expect(seen!.cancelable).toBe(true);
  });
});

describe("installImeChordGuard in real WebKit", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.contentEditable = "true";
    document.body.appendChild(host);
    host.focus();
  });

  it("stops the character from reaching a contenteditable while Control is held", async () => {
    holdControl();
    document.execCommand("insertText", false, IME_BACKQUOTE);
    await flush();
    expect(host.textContent).toBe("");
  });

  it("lets the same character through with no modifier held", async () => {
    document.execCommand("insertText", false, IME_BACKQUOTE);
    await flush();
    expect(host.textContent).toBe(IME_BACKQUOTE);
  });
});

describe("the editor honours the cancellation", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: createTiptapExtensions() });
    editor.view.focus();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("leaves the document clean when a chord's character is vetoed", async () => {
    const before = editor.getText();
    holdControl();
    document.execCommand("insertText", false, IME_BACKQUOTE);
    await flush();
    expect(editor.getText()).toBe(before);
  });

  it("still accepts ordinary typed text", async () => {
    document.execCommand("insertText", false, "hello");
    await flush();
    expect(editor.getText()).toContain("hello");
  });
});
