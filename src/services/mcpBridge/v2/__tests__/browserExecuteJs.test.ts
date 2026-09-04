// @vitest-environment node
// Audit 2026-09-03 E-04 — execute_js results were transported lossily: objects as
// Apple `description` text, throws as "<null>" with success. The wrapper makes
// every outcome a JSON string with an explicit ok flag.
import { describe, it, expect } from "vitest";
import { wrapExecuteJsScript, unwrapExecuteJsResult } from "@/services/mcpBridge/v2/browserExecuteJs";

/** Run the wrapped script the way callAsyncJavaScript does: as an async function body. */
async function runWrapped(userScript: string): Promise<string> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    body: string,
  ) => () => Promise<string>;
  return new AsyncFunction(wrapExecuteJsScript(userScript))();
}

describe("wrapExecuteJsScript", () => {
  it("JSON-encodes an object return instead of leaving it to the native description", async () => {
    expect(unwrapExecuteJsResult(await runWrapped("return {a:1, b:[true, null]}"))).toEqual({
      ok: true,
      value: { a: 1, b: [true, null] },
    });
  });

  it("returns null for undefined so 'nothing' is distinguishable from a failure", async () => {
    expect(unwrapExecuteJsResult(await runWrapped("const x = 1;"))).toEqual({ ok: true, value: null });
    expect(unwrapExecuteJsResult(await runWrapped("return undefined"))).toEqual({ ok: true, value: null });
  });

  it("reports a throw as ok:false with the message, never as a value", async () => {
    const out = unwrapExecuteJsResult(await runWrapped("return document.foo.bar"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/document|undefined/);
  });

  it("supports await in the body and non-Error throws", async () => {
    expect(unwrapExecuteJsResult(await runWrapped("return await Promise.resolve(42)"))).toEqual({
      ok: true,
      value: 42,
    });
    expect(unwrapExecuteJsResult(await runWrapped("throw 'plain'"))).toEqual({ ok: false, error: "plain" });
  });

  it("reports a value JSON cannot encode as a failure", async () => {
    const out = unwrapExecuteJsResult(await runWrapped("const a = {}; a.self = a; return a;"));
    expect(out.ok).toBe(false);
  });

  // Round 3, #47 — every value JSON cannot carry is refused BY NAME, wherever it
  // sits; only the "cannot encode a cycle" case was pinned before, while a nested
  // function silently vanished from the object and a nested `undefined` dropped its
  // key. The model reads the returned shape as page truth, so a key that was
  // present must come back present.
  describe("values JSON cannot carry", () => {
    it("refuses a function at the top level and nested, naming the key", async () => {
      expect(unwrapExecuteJsResult(await runWrapped("return function () {}"))).toEqual({
        ok: false,
        error: "unserializable value: function",
      });
      expect(unwrapExecuteJsResult(await runWrapped("return { a: 1, handler() {} }"))).toEqual({
        ok: false,
        error: "unserializable value: function at handler",
      });
    });

    it("refuses a symbol and a bigint, including inside an array", async () => {
      expect(unwrapExecuteJsResult(await runWrapped("return { s: Symbol('x') }"))).toEqual({
        ok: false,
        error: "unserializable value: symbol at s",
      });
      expect(unwrapExecuteJsResult(await runWrapped("return [1n]"))).toEqual({
        ok: false,
        error: "unserializable value: bigint at 0",
      });
    });

    it("refuses a non-finite number instead of the null JSON.stringify would emit", async () => {
      expect(unwrapExecuteJsResult(await runWrapped("return Infinity"))).toEqual({
        ok: false,
        error: "unserializable value: non-finite number",
      });
      expect(unwrapExecuteJsResult(await runWrapped("return { n: NaN, ok: 1 }"))).toEqual({
        ok: false,
        error: "unserializable value: non-finite number at n",
      });
    });

    it("encodes a nested undefined as null so the key survives, like the top level", async () => {
      // JSON has no `undefined`. Dropping the key (JSON.stringify's default) changes
      // the object's shape behind the model's back, and refusing would fail the most
      // common value in JS — a missing property read — so it is encoded, not lost.
      const out = unwrapExecuteJsResult(await runWrapped("return { a: undefined, b: [undefined, 2], c: { d: undefined } }"));
      expect(out).toEqual({ ok: true, value: { a: null, b: [null, 2], c: { d: null } } });
      if (out.ok) expect(Object.keys(out.value as object)).toEqual(["a", "b", "c"]);
    });
  });

  it("is deterministic, so the payload-hash binding still holds", () => {
    expect(wrapExecuteJsScript("return 1")).toBe(wrapExecuteJsScript("return 1"));
    expect(wrapExecuteJsScript("return 1")).not.toBe(wrapExecuteJsScript("return 2"));
  });
});

describe("unwrapExecuteJsResult", () => {
  it("treats a non-string, non-JSON or off-shape result as a transport failure", () => {
    expect(unwrapExecuteJsResult(undefined).ok).toBe(false);
    expect(unwrapExecuteJsResult("<null>").ok).toBe(false);
    expect(unwrapExecuteJsResult('{"value":1}').ok).toBe(false);
    expect(unwrapExecuteJsResult('{"ok":false}')).toEqual({ ok: false, error: "unknown script error" });
  });
});
