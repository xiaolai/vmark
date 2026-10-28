/**
 * Diff worker entry — the module worker that runs exact canonical diffs off
 * the main thread, where the budgeted diff can terminate it at a deadline.
 *
 * Loaded only as `new Worker(new URL("./diffWorker.ts", import.meta.url),
 * { type: "module" })`: the app's CSP (`script-src 'self'`, no `worker-src`)
 * refuses blob and inline workers. Before announcing `ready` it runs a short
 * warm-up diff so a freshly spawned replacement is not cold when the next
 * deadline starts.
 *
 * @coordinates-with ./budgetedDiff.ts — spawns this worker and owns its lifetime
 * @module services/agentJournal/review/diffWorker
 */

import { handleDiffRequest } from "./diffProtocol";

/** The slice of the dedicated worker global this entry uses. */
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => scope.postMessage(handleDiffRequest(event.data)));

const warm = Array.from({ length: 400 }, (_, i) => `warm-up line ${i} lorem ipsum ${i % 7}`).join("\n");
handleDiffRequest({ type: "diff", id: 0, a: warm, b: warm.replace(/ 3(\d)\b/g, " X$1") });
scope.postMessage({ type: "ready" });
