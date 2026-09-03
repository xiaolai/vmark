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
