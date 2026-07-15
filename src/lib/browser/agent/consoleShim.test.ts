// WI-P7.1 — console capture shim (Option C: page-world override → shared DOM ring
// buffer → isolated-world reader). No message handler, so the no-bridge invariant
// holds. Captured output is page-controlled and UNTRUSTED (treated like a read).
import { describe, it, expect, beforeEach } from "vitest";
import { installConsoleCapture, buildConsoleReadScript, CONSOLE_BUFFER_ID } from "./consoleShim";

function fakeConsole() {
  const calls: string[] = [];
  const rec = (l: string) => (...a: unknown[]) => calls.push(`${l}:${a.join(",")}`);
  return { calls, obj: { log: rec("log"), info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug") } };
}
function readBuffer(): Array<{ level: string; text: string }> {
  const el = document.getElementById(CONSOLE_BUFFER_ID);
  return el ? JSON.parse(el.textContent || "[]") : [];
}

beforeEach(() => {
  document.getElementById(CONSOLE_BUFFER_ID)?.remove();
});

describe("installConsoleCapture", () => {
  it("records each console.* call into the shared DOM buffer with its level", () => {
    const { obj } = fakeConsole();
    installConsoleCapture(obj, document, 200);
    obj.log("hello", "world");
    obj.error("boom");
    const buf = readBuffer();
    expect(buf).toEqual([
      { level: "log", text: "hello world" },
      { level: "error", text: "boom" },
    ]);
  });

  it("still calls the original console (capture is transparent)", () => {
    const { calls, obj } = fakeConsole();
    installConsoleCapture(obj, document, 200);
    obj.warn("x");
    expect(calls).toContain("warn:x");
  });

  it("JSON-stringifies non-string args and caps very long text", () => {
    const { obj } = fakeConsole();
    installConsoleCapture(obj, document, 200);
    obj.log({ a: 1 }, "z".repeat(5000));
    const [entry] = readBuffer();
    expect(entry.text).toContain('{"a":1}');
    expect(entry.text.length).toBeLessThanOrEqual(2100); // capped, not unbounded
  });

  it("is a bounded ring buffer — old entries drop past the cap", () => {
    const { obj } = fakeConsole();
    installConsoleCapture(obj, document, 3);
    for (let i = 0; i < 10; i++) obj.log(`m${i}`);
    const buf = readBuffer();
    expect(buf).toHaveLength(3);
    expect(buf.map((e) => e.text)).toEqual(["m7", "m8", "m9"]);
  });

  it("never throws even if an argument is not serializable", () => {
    const { obj } = fakeConsole();
    installConsoleCapture(obj, document, 200);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => obj.log(cyclic)).not.toThrow();
    expect(readBuffer().length).toBe(1);
  });
});

describe("buildConsoleReadScript", () => {
  it("reads the buffer element and returns entries", () => {
    expect(buildConsoleReadScript(false)).toContain(CONSOLE_BUFFER_ID);
    expect(buildConsoleReadScript(false)).toContain("entries");
  });

  it("the clear variant also empties the buffer", () => {
    expect(buildConsoleReadScript(true)).toContain('textContent="[]"');
    expect(buildConsoleReadScript(false)).not.toContain('textContent="[]"');
  });
});
