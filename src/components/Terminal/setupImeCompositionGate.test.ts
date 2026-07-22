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
    fireInput(textarea, "a");
    expect(commits).toEqual([]);
  });
});

describe("createNoopImeHandle", () => {
  it("is inert — composing false, commit setter ignored, no throw", () => {
    const h = createNoopImeHandle();
    expect(h.composing).toBe(false);
    expect(h.inGracePeriod).toBe(false);
    h.onCompositionCommit = () => { throw new Error("should never be called"); };
    expect(h.onCompositionCommit).toBeNull();
    expect(() => { h.cleanup(); h.flushPending(); }).not.toThrow();
  });
});
