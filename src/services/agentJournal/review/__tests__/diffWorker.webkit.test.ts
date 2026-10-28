// WI-AL2.1a — The real diff module worker in real WebKit under the app's CSP: a blob worker is refused (the control that proves the policy is live), the module worker loaded by URL starts and returns exact canonical changes, a pathological pair is cut off at the deadline with the worker terminated and ONE coarse change returned, and the warm spare serves the next call.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// The shipped policy, read from the Tauri config rather than restated here.
import tauriConf from "../../../../../src-tauri/tauri.conf.json";
import { BudgetedDiff } from "../budgetedDiff";
import { createDiffWorker, DIFF_DEADLINE_MS, type DiffWorkerLike } from "../diffBudget";

beforeAll(() => {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = tauriConf.app.security.csp;
  document.head.prepend(meta);
});

/** Whether a worker built from a blob URL runs; resolves "refused" on a throw or an error event. */
function blobWorkerOutcome(): Promise<"ran" | "refused"> {
  const url = URL.createObjectURL(new Blob(["postMessage('ran')"], { type: "text/javascript" }));
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(url);
    } catch {
      resolve("refused");
      return;
    }
    w.addEventListener("message", () => (w.terminate(), resolve("ran")));
    w.addEventListener("error", () => (w.terminate(), resolve("refused")));
  });
}

/** Random text over a small alphabet: two of these share many short runs and no long ones. */
function noise(length: number, seed: number): string {
  let s = seed >>> 0;
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push("abcd\n"[s % 5]);
  }
  return out.join("");
}

describe("the diff worker under the app CSP", () => {
  let lib: BudgetedDiff | null = null;
  afterEach(() => lib?.close());

  it("the CSP is live: a blob worker is refused", async () => {
    expect(tauriConf.app.security.csp).toContain("script-src 'self'");
    expect(await blobWorkerOutcome()).toBe("refused");
  });

  it("loads the module worker by URL and returns exact canonical changes", async () => {
    lib = new BudgetedDiff({ factory: createDiffWorker });
    lib.warm();
    await vi.waitFor(() => expect(lib?.status().state).toBe("ready"), { timeout: 10_000 });
    const out = await lib.diff("a😀b", "a😁b");
    expect(out).toMatchObject({ mode: "exact", changes: [{ fromA: 1, toA: 3, fromB: 1, toB: 3 }], dispatched: true });
    expect(lib.status().spawnFailures).toBe(0);
  });

  it("terminates the worker at the deadline on a pathological pair, then the spare takes over", async () => {
    const spawned: { worker: DiffWorkerLike; terminated: boolean }[] = [];
    lib = new BudgetedDiff({
      factory: () => {
        const worker = createDiffWorker();
        const entry = { worker, terminated: false };
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => ((entry.terminated = true), terminate());
        spawned.push(entry);
        return worker;
      },
    });
    lib.warm();
    await vi.waitFor(() => expect(lib?.status().state).toBe("ready"), { timeout: 10_000 });
    await vi.waitFor(() => expect(lib?.status().spareReady).toBe(true), { timeout: 10_000 });

    const a = noise(200_000, 1);
    const b = noise(200_000, 2);
    let late = false;
    const control = setTimeout(() => (late = true), DIFF_DEADLINE_MS);
    const out = await lib.diff(a, b);
    clearTimeout(control);
    expect(late).toBe(false);
    expect(out).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: true });
    expect(out.changes).toHaveLength(1);
    expect(spawned[0].terminated).toBe(true);

    const next = await lib.diff("ab12cd", "aX12Yd");
    expect(next).toMatchObject({ mode: "exact", changes: [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }, { fromA: 4, toA: 5, fromB: 4, toB: 5 }] });
    expect(spawned[1].terminated).toBe(false);
  });
});
