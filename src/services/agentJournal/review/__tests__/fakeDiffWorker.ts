// WI-AL2.1a — A scripted stand-in for the diff module worker: records what it is sent and whether it was terminated, and delivers ready, results, failures and errors only when a test says so.
import type { DiffRequest } from "../diffProtocol";
import type { DiffWorkerFactory, DiffWorkerLike } from "../diffBudget";
import { exactCanonicalDiff } from "../canonicalDiff";

type Listener = (event: { data?: unknown; message?: string }) => void;

class FakeDiffWorker implements DiffWorkerLike {
  readonly posted: DiffRequest[] = [];
  terminated = false;
  /** Runs inside `postMessage`, on the caller's thread: a stand-in for structured-clone cost. */
  onPost: ((request: DiffRequest) => void) | null = null;
  readonly #listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const set = this.#listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.#listeners.get(type)?.delete(listener);
  }
  postMessage(message: unknown): void {
    const request = message as DiffRequest;
    this.posted.push(request);
    this.onPost?.(request);
  }
  terminate(): void {
    this.terminated = true;
  }

  /** Deliver `data` as a message — even after terminate, to prove the library ignores a retired worker. */
  emit(data: unknown): void {
    for (const l of [...(this.#listeners.get("message") ?? [])]) l({ data });
  }
  ready(): void {
    this.emit({ type: "ready" });
  }
  /** Answer the last request the way the real worker would. */
  answer(request: DiffRequest | undefined = this.posted.at(-1)): void {
    if (!request) throw new Error("nothing was posted");
    this.emit({ type: "result", id: request.id, changes: exactCanonicalDiff(request.a, request.b) });
  }
  error(message = "worker crashed"): void {
    for (const l of [...(this.#listeners.get("error") ?? [])]) l({ message });
  }
}

export interface FakeFactory {
  factory: DiffWorkerFactory;
  workers: FakeDiffWorker[];
  /** When set, the next spawns throw this (a CSP refusal throws synchronously). */
  throwOnSpawn: Error | null;
  /** Called with each new worker: lets a test make every worker ready at once, or never. */
  onSpawn: ((w: FakeDiffWorker) => void) | null;
}

export function fakeFactory(): FakeFactory {
  const f: FakeFactory = {
    workers: [],
    throwOnSpawn: null,
    onSpawn: null,
    factory: () => {
      if (f.throwOnSpawn) throw f.throwOnSpawn;
      const w = new FakeDiffWorker();
      f.workers.push(w);
      f.onSpawn?.(w);
      return w;
    },
  };
  return f;
}
