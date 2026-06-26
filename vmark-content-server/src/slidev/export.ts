/**
 * Slidev export (Phase 7) — shells out to `slidev export` (CLI-only; needs
 * playwright-chromium). The spawn + entry resolver are injectable so the
 * arg-building and failure handling are unit-testable without a browser.
 *
 * @module slidev/export
 */

import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

export type SlidevFormat = "pdf" | "png" | "pptx";

/** Build the `slidev export …` argument vector (verified against S0.3). */
export function buildExportArgs(deck: string, format: SlidevFormat, output: string): string[] {
  return ["export", deck, "--format", format, "--output", output];
}

/** Minimal child shape so a fake can stand in for `child_process` in tests. */
interface SpawnedLike {
  stderr: { on: (e: "data", cb: (d: unknown) => void) => void } | null;
  on(e: "error", cb: (err: Error) => void): void;
  on(e: "exit", cb: (code: number | null) => void): void;
  kill?: (signal?: string) => void;
}
type SpawnFn = (cmd: string, args: string[], opts: { cwd: string }) => SpawnedLike;

export interface ExportDeps {
  spawn?: SpawnFn;
  /** Resolve the slidev CLI entry; defaults to the provisioned `@slidev/cli`. */
  resolveEntry?: () => string;
  /** Node executable; defaults to the current process. */
  nodeExe?: string;
  /** Hard timeout (ms) before the export child is killed. Default 180s. */
  timeoutMs?: number;
  /** Cancellation: abort kills the export child and rejects (WI-7.3). */
  signal?: AbortSignal;
}

function defaultResolveEntry(): string {
  // Resolved from the content-server location → the provisioned node_modules.
  const meta = import.meta as unknown as { resolve: (s: string) => string };
  return fileURLToPath(meta.resolve("@slidev/cli/bin/slidev.mjs"));
}

/**
 * Run `slidev export`. Resolves with the output path on success; rejects with
 * the captured stderr (e.g. missing Chromium) on failure.
 */
export async function runSlidevExport(
  deck: string,
  format: SlidevFormat,
  output: string,
  deps: ExportDeps = {}
): Promise<string> {
  const spawn = (deps.spawn ?? (nodeSpawn as unknown as SpawnFn));
  const entry = (deps.resolveEntry ?? defaultResolveEntry)();
  const nodeExe = deps.nodeExe ?? process.execPath;
  const args = [entry, ...buildExportArgs(deck, format, output)];

  const timeoutMs = deps.timeoutMs ?? 180_000;
  const signal = deps.signal;
  // Already-cancelled: never spawn (WI-7.3).
  if (signal?.aborted) {
    throw new Error("slidev export cancelled");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(nodeExe, args, { cwd: path.dirname(deck) });
    let stderr = "";
    let settled = false;
    let onAbort: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      fn();
    };
    // Codex audit: bound the export so a hung child can't run forever.
    const timer = setTimeout(() => {
      child.kill?.("SIGKILL");
      finish(() => reject(new Error(`slidev export timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    // WI-7.3 — cancellation: abort kills the child and rejects.
    if (signal) {
      onAbort = () => {
        child.kill?.("SIGKILL");
        finish(() => reject(new Error("slidev export cancelled")));
      };
      signal.addEventListener("abort", onAbort);
      // Close the gap between the pre-spawn check and listener registration: if
      // the signal aborted in that window, the listener missed it — fire now.
      if (signal.aborted) onAbort();
    }
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("exit", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `slidev export exited with code ${code}`));
      });
    });
  });
  return output;
}
