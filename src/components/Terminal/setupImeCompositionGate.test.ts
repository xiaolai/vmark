/**
 * jsdom tests for the gate module's commit-DECISION logic (F1/F2 from the audit).
 * These are same-task echo/orphan behaviors — synthetic events + fake timers are
 * faithful here (no dependence on the microtask-between-listeners ordering that
 * jsdom gets wrong; that is covered in the webkit tier).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupImeCompositionGate, createNoopImeHandle } from "./setupImeCompositionGate";

function makeHarness() {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.appendChild(textarea);
  document.body.appendChild(container);
  const handle = setupImeCompositionGate({ container, textarea });
  const commits: string[] = [];
  handle.onCompositionCommit = (t) => commits.push(t);
  return { container, textarea, handle, commits };
}

function fireComposition(ta: HTMLTextAreaElement, type: "compositionstart" | "compositionend", data = "") {
  ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
}
function fireInput(ta: HTMLTextAreaElement, data: string, inputType = "insertText") {
  ta.value = data;
  ta.dispatchEvent(new InputEvent("input", { data, inputType, isComposing: false, bubbles: true }));
}
/**
 * A keydown as macOS/WebKit reports it while a CJK input source owns the key:
 * keyCode 229, no composition. terminalKeyHandler's T2 consumes these, so xterm
 * never writes the character (#1176).
 */
function fireImeKeydown(ta: HTMLTextAreaElement) {
  ta.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }));
}
/** A keydown carrying a real keyCode — xterm's keydown path writes this one. */
function firePlainKeydown(ta: HTMLTextAreaElement, key: string, keyCode: number) {
  ta.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, bubbles: true }));
}

describe("setupImeCompositionGate — commit decisions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("commits a normal composition once (你好)", () => {
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionstart");
    textarea.value = "你好";
    fireComposition(textarea, "compositionend", "你好");
    expect(commits).toEqual(["你好"]);
  });

  it("does NOT re-commit a trailing insertText echoing a just-ended composition (F1)", () => {
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionstart");
    textarea.value = "。";
    fireComposition(textarea, "compositionend", "。");
    fireInput(textarea, "。"); // post-commit echo, same task → dropped
    expect(commits).toEqual(["。"]);
  });

  it("does NOT re-commit a re-fired compositionend restating the same text (F2 re-fire)", () => {
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionstart");
    textarea.value = "你好";
    fireComposition(textarea, "compositionend", "你好");
    fireComposition(textarea, "compositionend", "你好"); // #659-style re-fire → dropped
    expect(commits).toEqual(["你好"]);
  });

  it("orphan compositionend (no start) ignores a stale textarea, commits only non-ASCII e.data (F2)", () => {
    const { textarea, commits } = makeHarness();
    textarea.value = "stale pasted text"; // never part of a composition
    fireComposition(textarea, "compositionend", "?"); // ASCII e.data, no start
    expect(commits).toEqual([]); // must NOT commit the stale textarea
  });

  it("orphan compositionend commits fresh non-ASCII e.data (fcitx5/rime fresh commit)", () => {
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionend", "你好"); // no start, real data
    expect(commits).toEqual(["你好"]);
  });

  it("commits an ASCII composition RESULT — T2 blocked xterm's keydown (audit D3.1)", () => {
    // A real composition (Japanese/Korean can commit half-width alphanumerics)
    // that resolves to ASCII must still reach the PTY: nothing else delivers it.
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionstart");
    textarea.value = "abc";
    fireComposition(textarea, "compositionend", "abc");
    expect(commits).toEqual(["abc"]);
  });

  it("still ignores ASCII from an ORPHAN compositionend (no real composition)", () => {
    // The D3.1 fallback is gated on a real compositionstart; an orphan ASCII end
    // must NOT commit (would inject stale/garbage — F2).
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionend", "abc"); // no start
    expect(commits).toEqual([]);
  });

  it("the SAME char typed in a LATER task commits again (echo token is task-scoped)", () => {
    const { textarea, commits } = makeHarness();
    fireInput(textarea, "。"); // WeChat-style commit #1
    vi.advanceTimersByTime(1); // task ends → echo token clears
    fireInput(textarea, "。"); // a genuine second keystroke
    expect(commits).toEqual(["。", "。"]);
  });

  it("forwards a no-composition non-ASCII insert once (WeChat Shift punctuation)", () => {
    const { textarea, commits } = makeHarness();
    fireInput(textarea, "？");
    expect(commits).toEqual(["？"]);
  });

  it("ignores plain ASCII inserts (xterm keydown owns ASCII)", () => {
    const { textarea, commits } = makeHarness();
    firePlainKeydown(textarea, "a", 65);
    fireInput(textarea, "a");
    expect(commits).toEqual([]);
  });

  it("forwards an insert that arrived with no keydown behind it", () => {
    // Ordering identifies it: xterm's keydown path writes BEFORE the insert, so
    // an insert with no keydown yet cannot be xterm's. This is the first
    // keystroke of an IME run, which the mode flag alone would lose.
    const { textarea, commits } = makeHarness();
    fireInput(textarea, "a");
    expect(commits).toEqual(["a"]);
  });

  it("still drops the insert that follows a real keydown", () => {
    const { textarea, commits } = makeHarness();
    firePlainKeydown(textarea, "a", 65); // xterm wrote it here
    fireInput(textarea, "a");
    expect(commits).toEqual([]);
  });
});

describe("setupImeCompositionGate — ASCII claimed by an IME keydown (#1176)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("commits `/` when the keydown was an IME keydown (Shuangpin: T2 ate the keydown)", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireInput(textarea, "/");
    expect(commits).toEqual(["/"]);
  });

  it("commits numpad digits claimed by the IME", () => {
    const { textarea, commits } = makeHarness();
    for (const d of ["1", "2", "3", "4"]) {
      fireImeKeydown(textarea);
      fireInput(textarea, d);
      vi.advanceTimersByTime(1); // each digit is its own task
    }
    expect(commits).toEqual(["1", "2", "3", "4"]);
  });

  it("commits a multi-character ASCII insert claimed by the IME", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireInput(textarea, "ab");
    expect(commits).toEqual(["ab"]);
  });

  it("does NOT double-write when xterm's keydown path already owns the key", () => {
    const { textarea, commits } = makeHarness();
    firePlainKeydown(textarea, "/", 191);
    fireInput(textarea, "/");
    expect(commits).toEqual([]);
  });

  it("clears the textarea after forwarding, so xterm's finalizer reads nothing", () => {
    const { textarea } = makeHarness();
    fireImeKeydown(textarea);
    fireInput(textarea, "/");
    expect(textarea.value).toBe("");
  });

  it("stops the input event so xterm's _inputEvent cannot also write it", () => {
    const { textarea, commits } = makeHarness();
    const seenByXterm: string[] = [];
    textarea.addEventListener("input", (e) => seenByXterm.push((e as InputEvent).data ?? ""));
    fireImeKeydown(textarea);
    fireInput(textarea, "/");
    expect(commits).toEqual(["/"]);
    expect(seenByXterm).toEqual([]);
  });

  it("spends ownership once, but a second keyless insert is still ours to carry", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireInput(textarea, "/");
    vi.advanceTimersByTime(1); // clear the echo token so isEcho can't mask this
    fireInput(textarea, "/"); // no keydown of its own — nobody else can write it
    expect(commits).toEqual(["/", "/"]);
  });

  it("does not re-commit the ASCII echo of a composition that just ended (F1)", () => {
    // Japanese/Korean can commit half-width alphanumerics. The compositionend
    // commits "abc"; the trailing insertText restating it is an echo, and the
    // keydown that confirmed the composition was an IME keydown.
    const { textarea, commits } = makeHarness();
    fireComposition(textarea, "compositionstart");
    textarea.value = "abc";
    fireComposition(textarea, "compositionend", "abc");
    fireImeKeydown(textarea);
    fireInput(textarea, "abc");
    expect(commits).toEqual(["abc"]);
  });

  it("ignores an IME keydown that produces no insert (candidate selection)", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    expect(commits).toEqual([]);
  });

  it("keyup does NOT retire ownership — the insert may still be coming", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 229, bubbles: true }));
    fireInput(textarea, "/");
    expect(commits).toEqual(["/"]);
  });

  it("leaves composition inserts to the composition cycle", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireComposition(textarea, "compositionstart");
    textarea.value = "n";
    textarea.dispatchEvent(
      new InputEvent("input", {
        data: "n",
        inputType: "insertCompositionText",
        isComposing: true,
        bubbles: true,
      }),
    );
    expect(commits).toEqual([]);
  });

  it("stops listening after cleanup", () => {
    const { textarea, handle, commits } = makeHarness();
    handle.cleanup();
    fireImeKeydown(textarea);
    fireInput(textarea, "/");
    expect(commits).toEqual([]);
  });
});

describe("createNoopImeHandle", () => {
  it("is inert — composing false, commit setter ignored, no throw", () => {
    const h = createNoopImeHandle();
    expect(h.composing).toBe(false);
    h.onCompositionCommit = () => { throw new Error("should never be called"); };
    expect(h.onCompositionCommit).toBeNull();
    expect(() => h.cleanup()).not.toThrow();
  });
});

describe("setupImeCompositionGate — insert ownership (#1176 follow-ups)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  // THE reported regression. An IME can defer its insert past the key release —
  // likeliest at the start of a line, where it must first decide whether a
  // Chinese word is beginning. Retiring ownership on keyup dropped exactly that
  // first keystroke, which is what the user saw.
  it("forwards the insert even when keyup arrives BEFORE it", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 229, bubbles: true }));
    fireInput(textarea, "/");
    expect(commits).toEqual(["/"]);
  });

  it("forwards a digit when keyup arrives before it", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 229, bubbles: true }));
    fireInput(textarea, "1");
    expect(commits).toEqual(["1"]);
  });

  it("keeps forwarding when an unrelated modifier is released first", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", keyCode: 16, bubbles: true }));
    fireInput(textarea, "?");
    expect(commits).toEqual(["?"]);
  });

  it("survives overlapping keystrokes (B pressed before A released)", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireImeKeydown(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 229, bubbles: true }));
    fireInput(textarea, "2");
    expect(commits).toEqual(["2"]);
  });

  // IME mode is STICKY, so an insert that arrives before its own keydown — the
  // order a live Shuangpin trace records — is still forwarded.
  it("forwards an insert with no keydown of its own while in IME mode", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea); // IME announces itself
    vi.advanceTimersByTime(1);
    fireInput(textarea, "/"); // insert for the NEXT keystroke, keydown not yet seen
    expect(commits).toEqual(["/"]);
  });

  it("stays in IME mode across several keystrokes", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    for (const c of ["1", "2", "3"]) {
      fireInput(textarea, c);
      fireImeKeydown(textarea);
      vi.advanceTimersByTime(1);
    }
    expect(commits).toEqual(["1", "2", "3"]);
  });

  it("leaves IME mode when a real keyCode returns", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireInput(textarea, "1");
    vi.advanceTimersByTime(1);
    firePlainKeydown(textarea, "a", 65); // IME switched off
    fireInput(textarea, "a"); // xterm owns it again
    expect(commits).toEqual(["1"]);
  });

  it("a real non-IME keydown keeps its own insert away from us", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea); // produced no insert
    firePlainKeydown(textarea, "a", 65); // takes ownership back
    fireInput(textarea, "a");
    expect(commits).toEqual([]);
  });

  it("falls back to a SINGLE textarea character when the IME reports null data", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.value = "/";
    textarea.dispatchEvent(
      new InputEvent("input", {
        data: null,
        inputType: "insertText",
        isComposing: false,
        bubbles: true,
      }),
    );
    expect(commits).toEqual(["/"]);
  });
});

describe("setupImeCompositionGate — composition then plain insert (same keystroke)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  function fireCompositionInput(ta: HTMLTextAreaElement, data: string) {
    ta.value = data;
    ta.dispatchEvent(
      new InputEvent("input", {
        data,
        inputType: "insertCompositionText",
        isComposing: true,
        bubbles: true,
      }),
    );
  }

  it("still forwards the insertText that follows a composition cycle", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireComposition(textarea, "compositionstart");
    fireCompositionInput(textarea, "/");
    fireComposition(textarea, "compositionend", "");
    fireInput(textarea, "/");
    expect(commits).toEqual(["/"]);
  });

  it("forwards a digit through the same sequence", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireComposition(textarea, "compositionstart");
    fireCompositionInput(textarea, "1");
    fireComposition(textarea, "compositionend", "");
    fireInput(textarea, "1");
    expect(commits).toEqual(["1"]);
  });

  it("does not double-commit when compositionend already delivered the text", () => {
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireComposition(textarea, "compositionstart");
    fireCompositionInput(textarea, "a");
    fireComposition(textarea, "compositionend", "a"); // commits "a"
    fireInput(textarea, "a"); // echo of the same commit → dropped
    expect(commits).toEqual(["a"]);
  });

  it("leaves ownership intact across a composition, for the insert that follows", () => {
    // A composition-phase input must not spend the keydown's ownership: on some
    // IMEs the real insertText arrives only after compositionend.
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    fireComposition(textarea, "compositionstart");
    fireCompositionInput(textarea, "n");
    fireComposition(textarea, "compositionend", "");
    fireInput(textarea, "n");
    expect(commits).toEqual(["n"]);
  });
});

describe("setupImeCompositionGate — textarea fallback is bounded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("never commits a whole buffer when the IME reports no data", () => {
    // The fallback exists for a single character the IME failed to report.
    // Handing the shell an entire accumulated line would execute it.
    const { textarea, commits } = makeHarness();
    fireImeKeydown(textarea);
    textarea.value = "rm -rf /tmp/something";
    textarea.dispatchEvent(
      new InputEvent("input", {
        data: null,
        inputType: "insertText",
        isComposing: false,
        bubbles: true,
      }),
    );
    expect(commits).toEqual([]);
  });
});
