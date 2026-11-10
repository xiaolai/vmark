// Contract for the editor-surface warm-up the journey runner performs before
// its first journey.
//
// The failure it closes (issue 1659): on a cold dev server the first editor
// mount compiles ~2,300 modules on demand, which outlasts the 8 s poll every
// journey uses, so the first journey to open a tab timed out waiting for an
// editor that was merely still loading. A warm cache passes.

import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { EDITOR_SURFACE_MODULE, WARMUP_TIMEOUT_MS, warmEditorSurface } from "./warmup.mjs";

const ROOT = new URL("../../", import.meta.url);

describe("EDITOR_SURFACE_MODULE", () => {
  it("is the module the markdown format's wysiwygComponent thunk imports", () => {
    const adapter = readFileSync(new URL("src/lib/formats/adapters/markdown.tsx", ROOT), "utf8");
    const thunk = adapter.match(/wysiwygComponent:\s*\(\)\s*=>\s*import\("\.\/([^"]+)"\)/);
    expect(thunk, "markdown adapter no longer declares a plain import thunk").not.toBeNull();
    expect(EDITOR_SURFACE_MODULE).toBe(`/src/lib/formats/adapters/${thunk[1]}.tsx`);
  });

  it("names a file that exists", () => {
    expect(existsSync(new URL(EDITOR_SURFACE_MODULE.slice(1), ROOT))).toBe(true);
  });
});

describe("warmEditorSurface", () => {
  /** A client that answers each execute_js call from a scripted state sequence. */
  function fakeClient(states) {
    const calls = [];
    let n = 0;
    return {
      calls,
      send: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        const data = states[Math.min(n++, states.length - 1)];
        return data instanceof Error ? { success: false, error: data.message } : { success: true, data };
      },
    };
  }
  const FAST = { pollMs: 1 };

  it("starts the import in the page and returns once it is ready", async () => {
    const client = fakeClient([{ state: "loading" }, { state: "loading" }, { state: "ready" }]);
    await warmEditorSurface(client, FAST);
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0].args.script).toContain(`import(${JSON.stringify(EDITOR_SURFACE_MODULE)})`);
  });

  it("never asks the bridge to wait past its own per-call ceiling", async () => {
    // The bridge plugin gives an execute_js 5 s; a cold import takes longer, so
    // no single call may be the thing that waits for it.
    const client = fakeClient([{ state: "loading" }, { state: "ready" }]);
    await warmEditorSurface(client, FAST);
    for (const c of client.calls) expect(c.timeoutMs).toBeLessThan(WARMUP_TIMEOUT_MS);
  });

  it("keeps polling a slow import rather than failing at the per-call ceiling", async () => {
    const loading = Array.from({ length: 20 }, () => ({ state: "loading" }));
    const client = fakeClient([...loading, { state: "ready" }]);
    await warmEditorSurface(client, FAST);
    expect(client.calls).toHaveLength(21);
  });

  it("fails loudly, with the page's reason, when the surface cannot load", async () => {
    const client = fakeClient([{ state: "loading" }, { state: "failed", error: "Importing a module script failed" }]);
    await expect(warmEditorSurface(client, FAST)).rejects.toThrow(/warm the editor surface.*Importing a module script failed/s);
  });

  it("fails when the page reloaded under the import (state lost)", async () => {
    const client = fakeClient([{ state: "loading" }, { state: "missing" }]);
    await expect(warmEditorSurface(client, FAST)).rejects.toThrow(/page state/);
  });

  it("gives up when the budget is spent", async () => {
    const client = fakeClient([{ state: "loading" }]);
    await expect(warmEditorSurface(client, { timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/within 30ms/);
  });

  it("reports a bridge failure instead of hiding it", async () => {
    const client = fakeClient([new Error("Script execution timeout")]);
    await expect(warmEditorSurface(client, FAST)).rejects.toThrow(/Script execution timeout/);
  });

  it("evaluates, as written, to the states it reports", async () => {
    // Run the real scripts against a stub page so a typo in them fails HERE.
    const { runInNewContext } = await import("node:vm");
    let resolveImport;
    const page = { import: () => new Promise((r) => { resolveImport = r; }) };
    const client = {
      send: async (_c, { script }) => ({
        success: true,
        // `import(...)` is syntax, not a function: route it to the stub.
        data: runInNewContext(script.replace(/\bimport\(/g, "__imp("), { window: page, __imp: page.import }),
      }),
    };
    const done = warmEditorSurface(client, { pollMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    resolveImport({});
    await expect(done).resolves.toBeUndefined();
  });
});
