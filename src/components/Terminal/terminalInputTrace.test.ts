import { describe, it, expect, vi } from "vitest";
import {
  createInputTrace,
  recordFromEvent,
  attachInputTrace,
} from "./terminalInputTrace";

describe("createInputTrace", () => {
  it("stamps t from an injected clock and preserves order", () => {
    let now = 1000;
    const trace = createInputTrace(100, () => now);
    trace.mark({ kind: "keydown" });
    now = 1005;
    trace.mark({ kind: "input" });
    const snap = trace.snapshot();
    expect(snap.map((r) => r.kind)).toEqual(["keydown", "input"]);
    expect(snap[0].t).toBe(0);
    expect(snap[1].t).toBe(5);
  });

  it("is a bounded ring buffer — oldest records drop past the cap", () => {
    let now = 0;
    const trace = createInputTrace(3, () => now++);
    for (let i = 0; i < 5; i++) trace.mark({ kind: `k${i}` });
    expect(trace.snapshot().map((r) => r.kind)).toEqual(["k2", "k3", "k4"]);
  });

  it("clear() empties the buffer", () => {
    const trace = createInputTrace(10, () => 0);
    trace.mark({ kind: "x" });
    trace.clear();
    expect(trace.snapshot()).toEqual([]);
  });
});

describe("recordFromEvent", () => {
  it("captures KeyboardEvent fields including modifiers and keyCode", () => {
    const e = new KeyboardEvent("keydown", { key: "。", code: "Period", ctrlKey: true });
    const r = recordFromEvent("keydown", e, "buf", 3);
    expect(r).toMatchObject({ kind: "keydown", taValue: "buf", t: 3, key: "。", code: "Period", ctrlKey: true });
  });

  it("captures InputEvent data/inputType/isComposing/composed", () => {
    const e = new InputEvent("input", { data: "。", inputType: "insertText", composed: true });
    const r = recordFromEvent("input", e, "", 0);
    expect(r).toMatchObject({ kind: "input", data: "。", inputType: "insertText", composed: true });
  });

  it("captures CompositionEvent data", () => {
    const e = new CompositionEvent("compositionend", { data: "你好" });
    expect(recordFromEvent("compositionend", e, "", 0).data).toBe("你好");
  });
});

describe("attachInputTrace", () => {
  it("records real events dispatched on the textarea and detaches cleanly", () => {
    const ta = document.createElement("textarea");
    const trace = createInputTrace(100, () => 0);
    const detach = attachInputTrace({ textarea: ta, trace });

    ta.value = "。";
    ta.dispatchEvent(new InputEvent("input", { data: "。", inputType: "insertText", bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "。", keyCode: 229, bubbles: true }));
    expect(trace.snapshot().map((r) => r.kind)).toEqual(["input", "keydown"]);
    expect(trace.snapshot()[0].taValue).toBe("。");

    detach();
    ta.dispatchEvent(new InputEvent("input", { data: "x", bubbles: true }));
    expect(trace.snapshot()).toHaveLength(2); // no new records after detach
  });

  it("is a passive tap — never calls preventDefault/stopPropagation", () => {
    const ta = document.createElement("textarea");
    const trace = createInputTrace(100, () => 0);
    attachInputTrace({ textarea: ta, trace });
    const e = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    const pd = vi.spyOn(e, "preventDefault");
    ta.dispatchEvent(e);
    expect(pd).not.toHaveBeenCalled();
  });
});
