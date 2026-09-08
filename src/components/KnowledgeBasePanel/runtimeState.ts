/**
 * Runtime-availability state for the Knowledge Base panel (WI-FL1.1) — pure.
 *
 * Purpose: turn the `content_server_runtime` report into what the panel tells
 * the user, so the copy decisions (which half is missing, and what would
 * provide it in THIS kind of build) are testable without rendering.
 *
 * Key decisions:
 *   - A missing CLI reads differently by build. In a packaged build nothing the
 *     user can do provides it — no release ships the content server yet (plan
 *     decision D1) — so the copy says so. In development it names the two ways
 *     a developer supplies one: `VMARK_CONTENT_SERVER_CLI` or a provisioned
 *     `base-kb` runtime.
 *   - The CLI is listed before Node: on a release install it is the half that
 *     is always missing, so it is the one worth reading first.
 *   - A payload that is not the wire shape is a FAILED probe, never a ready
 *     runtime — an older backend, or a mock resolving `undefined`, must not
 *     silently reopen the start path the probe exists to gate.
 *
 * @coordinates-with src/services/contentServer/client.ts — the wire shape
 * @coordinates-with src-tauri/src/content_server/runtime.rs — the producer
 * @module components/KnowledgeBasePanel/runtimeState
 */
import type { ContentServerRuntime } from "@/services/contentServer";

/** Where the panel's probe stands. */
export type RuntimeProbe =
  | { phase: "checking" }
  | { phase: "known"; runtime: ContentServerRuntime }
  | { phase: "failed"; message: string };

/** The copy the missing states render, as flat `common.json` keys. */
export const RUNTIME_KEYS = {
  nodeMissing: "contentServer.runtime.nodeMissing",
  cliMissingPackaged: "contentServer.runtime.cliMissingPackaged",
  cliMissingDev: "contentServer.runtime.cliMissingDev",
} as const;

const isState = (value: unknown): value is ContentServerRuntime["node"] =>
  value === "ready" || value === "missing";
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isCliSource = (value: unknown): value is ContentServerRuntime["cliSource"] =>
  value === null || value === "env" || value === "bundled" || value === "provisioned";

/**
 * Narrow an IPC payload to the wire shape — every field, not just the two
 * states: a guard that accepted `{node:"ready", cli:"ready"}` alone let an
 * older backend's partial report reopen the start path this probe exists to
 * gate (audit 20260907). Anything else is a probe failure.
 *
 * Field types are not the whole shape: `classify` in `runtime.rs` produces the
 * state and its source from ONE match arm, so `ready` always names where it
 * came from and `missing` never does. A report that says `cli: "ready"` with
 * `cliSource: null` therefore came from something other than this backend, and
 * believing its "ready" half is exactly the partial-report failure above under
 * a second spelling (audit R2, #633).
 */
export function isContentServerRuntime(value: unknown): value is ContentServerRuntime {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (
    !isState(r.node) ||
    !isNullableString(r.nodePath) ||
    !isState(r.cli) ||
    !isCliSource(r.cliSource) ||
    !isNullableString(r.detail)
  ) {
    return false;
  }
  return (r.node === "ready") === (r.nodePath !== null) && (r.cli === "ready") === (r.cliSource !== null);
}

export function isRuntimeReady(runtime: ContentServerRuntime): boolean {
  return runtime.node === "ready" && runtime.cli === "ready";
}

/**
 * The keys naming what is missing and what would provide it, in display order.
 * Empty when the runtime is ready.
 */
export function runtimeMissingKeys(runtime: ContentServerRuntime, isDevBuild: boolean): string[] {
  const keys: string[] = [];
  if (runtime.cli === "missing") {
    keys.push(isDevBuild ? RUNTIME_KEYS.cliMissingDev : RUNTIME_KEYS.cliMissingPackaged);
  }
  if (runtime.node === "missing") keys.push(RUNTIME_KEYS.nodeMissing);
  return keys;
}
