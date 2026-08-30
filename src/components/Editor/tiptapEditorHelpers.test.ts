// Tests for the spellcheck-threshold helpers: the mount-time attribute must
// flip when a document crosses SPELLCHECK_DISABLE_CHAR_THRESHOLD mid-session
// (the original editorProps value is computed once and never re-evaluated).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  applySpellcheckForDocSize,
  buildTiptapEditorProps,
  CV_IDLE_CHAR_THRESHOLD,
  SPELLCHECK_DISABLE_CHAR_THRESHOLD,
  spellcheckAttrForDocSize,
  suppressCvIdleDuringEdit,
} from "./tiptapEditorHelpers";

describe("buildTiptapEditorProps", () => {
  it("snapshots the spellcheck attribute from the doc size", () => {
    const small = buildTiptapEditorProps(10).attributes as Record<string, string>;
    const large = buildTiptapEditorProps(
      SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1,
    ).attributes as Record<string, string>;
    expect(small.spellcheck).toBe("true");
    expect(large.spellcheck).toBe("false");
    expect(small.class).toBe("ProseMirror");
  });

  it("wires the table-aware scroll handler", () => {
    expect(typeof buildTiptapEditorProps(0).handleScrollToSelection).toBe("function");
  });
});

describe("spellcheckAttrForDocSize", () => {
  it.each([
    { docSize: 0, expected: "true" },
    { docSize: SPELLCHECK_DISABLE_CHAR_THRESHOLD, expected: "true" },
    { docSize: SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1, expected: "false" },
    { docSize: 1_000_000, expected: "false" },
  ])("docSize=$docSize → $expected", ({ docSize, expected }) => {
    expect(spellcheckAttrForDocSize(docSize)).toBe(expected);
  });
});

describe("applySpellcheckForDocSize", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      editorProps: {
        attributes: { class: "ProseMirror", spellcheck: "true" },
      },
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it("disables spellcheck when the doc grows past the threshold", () => {
    const changed = applySpellcheckForDocSize(
      editor,
      SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1,
    );
    expect(changed).toBe(true);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("false");
  });

  it("re-enables spellcheck when the doc shrinks below the threshold", () => {
    applySpellcheckForDocSize(editor, SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1);
    const changed = applySpellcheckForDocSize(editor, 10);
    expect(changed).toBe(true);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("true");
  });

  it("is a no-op when the attribute already matches", () => {
    expect(applySpellcheckForDocSize(editor, 10)).toBe(false);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("true");
  });

  it("preserves the other editorProps attributes when flipping", () => {
    applySpellcheckForDocSize(editor, SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1);
    expect(editor.view.dom.getAttribute("class")).toContain("ProseMirror");
  });

  it("survives an editor without a mounted view", () => {
    editor.destroy();
    expect(applySpellcheckForDocSize(editor, 10)).toBe(false);
  });
});

// #1340 — suppressCvIdleDuringEdit must preserve the viewport across BOTH
// cv-idle toggles (the synchronous strip and the 500ms idle re-add), and must
// skip all measurement on the per-keystroke hot path where the class is
// already off. Rects are mocked (jsdom has no layout), keyed on the live
// class list like a real engine's geometry would be.
describe("suppressCvIdleDuringEdit", () => {
  function buildCvDom() {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const container = document.createElement("div");
    container.className = "tiptap-editor cv-idle";
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    const anchor = document.createElement("p");
    pm.appendChild(anchor);
    container.appendChild(pm);
    scroller.appendChild(container);
    document.body.appendChild(scroller);

    const writes: number[] = [];
    let scrollTop = 500;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
        writes.push(v);
      },
    });
    const scrollerRect = vi.fn(() => ({ top: 0, bottom: 800 }));
    const anchorRect = vi.fn(() =>
      container.classList.contains("cv-idle")
        ? { top: 10, bottom: 40 }
        : { top: 50, bottom: 80 },
    );
    const toDomRect = (r: { top: number; bottom: number }) =>
      ({
        ...r,
        left: 0,
        right: 0,
        width: 0,
        height: r.bottom - r.top,
        x: 0,
        y: r.top,
        toJSON: () => ({}),
      }) as DOMRect;
    scroller.getBoundingClientRect = () => toDomRect(scrollerRect());
    anchor.getBoundingClientRect = () => toDomRect(anchorRect());
    return { scroller, container, writes, scrollerRect, anchorRect };
  }

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("compensates the viewport when stripping cv-idle, and again on the idle re-add", () => {
    vi.useFakeTimers();
    const { scroller, container } = buildCvDom();
    const containerRef = { current: container as HTMLDivElement };
    const timeoutRef = { current: null as number | null };

    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef);

    // Strip: anchor moved 10 → 50, so the scroller follows it down.
    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(scroller.scrollTop).toBe(540);
    expect(timeoutRef.current).not.toBeNull();

    // Idle re-add: anchor moves back 50 → 10, and the viewport returns too.
    vi.advanceTimersByTime(500);
    expect(container.classList.contains("cv-idle")).toBe(true);
    expect(scroller.scrollTop).toBe(500);
    expect(timeoutRef.current).toBeNull();
  });

  it("skips all measurement on the hot path when cv-idle is already off", () => {
    vi.useFakeTimers();
    const { container, writes, scrollerRect, anchorRect } = buildCvDom();
    container.classList.remove("cv-idle");
    const containerRef = { current: container as HTMLDivElement };
    const timeoutRef = { current: null as number | null };

    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef);

    expect(scrollerRect).not.toHaveBeenCalled();
    expect(anchorRect).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    // The idle re-add is still scheduled for large docs.
    expect(timeoutRef.current).not.toBeNull();
    vi.advanceTimersByTime(500);
    expect(container.classList.contains("cv-idle")).toBe(true);
  });

  it("does not schedule a re-add below the threshold but still compensates the strip", () => {
    vi.useFakeTimers();
    const { scroller, container } = buildCvDom();
    const containerRef = { current: container as HTMLDivElement };
    const timeoutRef = { current: null as number | null };

    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD - 1, timeoutRef);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(scroller.scrollTop).toBe(540);
    expect(timeoutRef.current).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(container.classList.contains("cv-idle")).toBe(false);
  });

  it("clears a pending re-add and reschedules on the next edit", () => {
    vi.useFakeTimers();
    const { container } = buildCvDom();
    const containerRef = { current: container as HTMLDivElement };
    const timeoutRef = { current: null as number | null };

    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef);
    const first = timeoutRef.current;
    vi.advanceTimersByTime(300);
    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef);
    expect(timeoutRef.current).not.toBe(first);

    // 300ms after the second edit the first timer would have fired; it must not.
    vi.advanceTimersByTime(300);
    expect(container.classList.contains("cv-idle")).toBe(false);
    vi.advanceTimersByTime(200);
    expect(container.classList.contains("cv-idle")).toBe(true);
  });

  it("re-adds class-only when the idle timer fires on a hidden editor", () => {
    // Source mode toggled within the 500ms window: display:none geometry
    // reports zero rects, so the re-add must still restore the class (the
    // optimization matters when the editor returns) without measuring a
    // compensation or writing scrollTop.
    vi.useFakeTimers();
    const { container, writes, anchorRect } = buildCvDom();
    const containerRef = { current: container as HTMLDivElement };
    const timeoutRef = { current: null as number | null };

    suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef);
    const writesAfterStrip = writes.length;

    // Hide the editor before the idle timer fires, zeroing all geometry the
    // way display:none does in a real engine.
    container.style.display = "none";
    anchorRect.mockImplementation(() => ({ top: 0, bottom: 0 }));

    vi.advanceTimersByTime(500);
    expect(container.classList.contains("cv-idle")).toBe(true);
    expect(writes.length).toBe(writesAfterStrip);
  });

  it("does nothing when the container ref is empty", () => {
    const containerRef = { current: null };
    const timeoutRef = { current: null as number | null };
    expect(() =>
      suppressCvIdleDuringEdit(containerRef, CV_IDLE_CHAR_THRESHOLD, timeoutRef),
    ).not.toThrow();
    expect(timeoutRef.current).toBeNull();
  });
});
