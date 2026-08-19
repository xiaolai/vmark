// WI-P7.1 / WI-NB3.1 — console capture, executed as THE SHIPPED BYTES: these
// tests run `consoleShim.src.js` (the exact asset Rust injects) in jsdom, so
// the tested copy and the executed copy cannot drift — the defect the old
// hand-maintained duplicate carried (audit 019fe61c).
import { describe, it, expect } from "vitest";
import { CONSOLE_SHIM_SRC, CONSOLE_BUFFER_ID, buildConsoleReadScript } from "./consoleShim";

type Entry = { level: string; text: string };

interface Harness {
  console: Record<string, (...args: unknown[]) => void>;
  listeners: Map<string, (ev: unknown) => void>;
  read(): Entry[];
}

/** Execute the shipped shim bytes against a fresh jsdom document + fake window. */
function install(originals: Record<string, (...args: unknown[]) => void> = {}): Harness {
  const doc = new DOMParser().parseFromString("<body></body>", "text/html");
  const consoleObj: Harness["console"] = { ...originals };
  const listeners = new Map<string, (ev: unknown) => void>();
  const windowObj = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => listeners.set(type, fn),
  };
  new Function("document", "console", "window", CONSOLE_SHIM_SRC)(doc, consoleObj, windowObj);
  return {
    console: consoleObj,
    listeners,
    read: () => JSON.parse(doc.getElementById(CONSOLE_BUFFER_ID)?.textContent ?? "[]") as Entry[],
  };
}

describe("the shipped shim bytes", () => {
  it("records each console.* call into the shared DOM buffer with its level", () => {
    const h = install();
    h.console.log("hello", "world");
    h.console.warn("careful");
    h.console.error("boom");
    expect(h.read()).toEqual([
      { level: "log", text: "hello world" },
      { level: "warn", text: "careful" },
      { level: "error", text: "boom" },
    ]);
  });

  it("still calls the original console (capture is transparent)", () => {
    const seen: unknown[][] = [];
    const h = install({ log: (...a: unknown[]) => void seen.push(a) });
    h.console.log("passthrough", 1);
    expect(seen).toEqual([["passthrough", 1]]);
  });

  it("JSON-stringifies non-string args and caps very long text", () => {
    const h = install();
    h.console.log({ a: 1 }, "x".repeat(5000));
    const [entry] = h.read();
    expect(entry.text.startsWith('{"a":1} xxx')).toBe(true);
    expect(entry.text.length).toBeLessThanOrEqual(2000);
  });

  it("is a bounded ring buffer — old entries drop past the cap (200)", () => {
    const h = install();
    for (let i = 0; i < 210; i++) h.console.log(`m${i}`);
    const entries = h.read();
    expect(entries).toHaveLength(200);
    expect(entries[0].text).toBe("m10");
    expect(entries[199].text).toBe("m209");
  });

  it("never throws even if an argument is not serializable", () => {
    const h = install();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => h.console.log(cyclic)).not.toThrow();
    expect(h.read()).toHaveLength(1);
  });

  it("captures uncaught errors with location (WI-NB3.1)", () => {
    const h = install();
    h.listeners.get("error")!({ message: "x is not a function", filename: "https://site/app.js", lineno: 12 });
    expect(h.read()).toEqual([
      { level: "error", text: "Uncaught x is not a function (https://site/app.js:12)" },
    ]);
  });

  it("captures unhandled rejections, preferring the reason's message", () => {
    const h = install();
    h.listeners.get("unhandledrejection")!({ reason: new Error("fetch failed") });
    h.listeners.get("unhandledrejection")!({ reason: { code: 42 } });
    expect(h.read()).toEqual([
      { level: "error", text: "Unhandled rejection: fetch failed" },
      { level: "error", text: 'Unhandled rejection: {"code":42}' },
    ]);
  });

  it("error capture never throws on a hostile event shape", () => {
    const h = install();
    expect(() => h.listeners.get("error")!(null)).not.toThrow();
    expect(() => h.listeners.get("unhandledrejection")!(null)).not.toThrow();
  });
});

describe("buildConsoleReadScript", () => {
  function runRead(doc: Document, clear: boolean): { entries: Entry[] } {
    const fn = new Function("document", buildConsoleReadScript(clear));
    return JSON.parse(fn(doc) as string) as { entries: Entry[] };
  }

  it("reads the buffer element and returns entries", () => {
    const doc = new DOMParser().parseFromString("<body></body>", "text/html");
    const consoleObj: Record<string, (...a: unknown[]) => void> = {};
    new Function("document", "console", "window", CONSOLE_SHIM_SRC)(doc, consoleObj, {
      addEventListener: () => {},
    });
    consoleObj.log("captured");
    expect(runRead(doc, false).entries).toEqual([{ level: "log", text: "captured" }]);
    // non-clearing read leaves the buffer
    expect(runRead(doc, false).entries).toHaveLength(1);
  });

  it("the clear variant also empties the buffer", () => {
    const doc = new DOMParser().parseFromString("<body></body>", "text/html");
    const consoleObj: Record<string, (...a: unknown[]) => void> = {};
    new Function("document", "console", "window", CONSOLE_SHIM_SRC)(doc, consoleObj, {
      addEventListener: () => {},
    });
    consoleObj.log("draining");
    expect(runRead(doc, true).entries).toHaveLength(1);
    expect(runRead(doc, false).entries).toHaveLength(0);
  });

  it("a corrupted buffer yields [] rather than a throw", () => {
    const doc = new DOMParser().parseFromString(
      `<body><script type="application/json" id="${CONSOLE_BUFFER_ID}">not json</script></body>`,
      "text/html",
    );
    expect(runRead(doc, false).entries).toEqual([]);
  });
});
