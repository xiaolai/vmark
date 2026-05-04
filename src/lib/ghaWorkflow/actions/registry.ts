/**
 * Purpose: Frontend registry that resolves a `uses:` step reference
 *   into typed action metadata (the keys/inputs/outputs the editor
 *   needs to populate the structured `with:` form). Calls the Rust
 *   gha_fetch_action_yml Tauri command which handles HTTP + on-disk
 *   cache; this module adds an in-session memoization layer so the
 *   same uses-string invokes Rust at most once per session.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md WI-6.1
 *
 * Failure mode is "return null":
 *   - Unparseable uses (./local, docker://, missing @ref): null, no invoke
 *   - NotFound (no action.yml exists): null, silently
 *   - NetworkError / ParseError: null, with diagnostic log
 *   - InvokeError (Tauri command unavailable): null
 *
 * Caller pattern: render the form with metadata; if null, fall back
 * to free-form key/value rows (per ADR-6).
 *
 * @coordinates-with src-tauri/src/gha_workflow/action_fetch.rs — Rust impl
 * @module lib/ghaWorkflow/actions/registry
 */

import { invoke } from "@tauri-apps/api/core";

export interface ActionRef {
  owner: string;
  repo: string;
  /** Path within the repo to the sub-action directory (empty for top-level). */
  path: string;
  ref: string;
}

export interface ActionInputSchema {
  description?: string;
  required?: boolean;
  default?: string;
  deprecation_message?: string;
}

export interface ActionOutputSchema {
  description?: string;
}

export interface ActionMetadata {
  name?: string;
  description?: string;
  author?: string;
  inputs: Record<string, ActionInputSchema>;
  outputs: Record<string, ActionOutputSchema>;
  /** "node20" | "docker" | "composite" | undefined. UI hint. */
  runs_using?: string;
}

interface RustOk {
  kind: "ok";
  from_cache: boolean;
  metadata: ActionMetadata;
}
interface RustNotFound {
  kind: "not_found";
  message: string;
}
interface RustNetworkError {
  kind: "network_error";
  message: string;
}
interface RustParseError {
  kind: "parse_error";
  message: string;
}
interface RustInvalidUses {
  kind: "invalid_uses";
  message: string;
}
type FetchResult =
  | RustOk
  | RustNotFound
  | RustNetworkError
  | RustParseError
  | RustInvalidUses;

const sessionCache = new Map<string, ActionMetadata | null>();
const inflight = new Map<string, Promise<ActionMetadata | null>>();

/**
 * Parse a `uses:` reference into its components. Returns null for
 * patterns that don't have an `action.yml` on raw.githubusercontent
 * (local refs, docker URIs, malformed strings).
 */
export function parseUsesRef(uses: string): ActionRef | null {
  if (uses.startsWith("./") || uses.startsWith("docker://")) return null;
  const at = uses.lastIndexOf("@");
  if (at < 0) return null;
  const ref = uses.slice(at + 1);
  if (!ref) return null;
  const slug = uses.slice(0, at);
  const parts = slug.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return {
    owner: parts[0],
    repo: parts[1],
    path: parts.slice(2).join("/"),
    ref,
  };
}

/**
 * Resolve action metadata. Memoized per uses-string for the lifetime of
 * the session. Returns null in all failure modes; never throws.
 */
export async function getActionMetadata(
  uses: string,
): Promise<ActionMetadata | null> {
  if (!parseUsesRef(uses)) return null;

  if (sessionCache.has(uses)) {
    return sessionCache.get(uses) ?? null;
  }

  const existing = inflight.get(uses);
  if (existing) return existing;

  const promise = (async () => {
    let result: FetchResult | undefined;
    try {
      result = await invoke<FetchResult>("gha_fetch_action_yml", { uses });
    } catch {
      sessionCache.set(uses, null);
      return null;
    }

    // Defensive: vi.fn() / unmocked invoke returns undefined; in production
    // the Tauri command always returns a FetchResult, but treating
    // undefined as "unavailable" keeps the form layer crash-free during
    // tests that exercise unrelated code paths.
    if (result && result.kind === "ok") {
      const metadata = normalizeMetadata(result.metadata);
      sessionCache.set(uses, metadata);
      return metadata;
    }

    sessionCache.set(uses, null);
    return null;
  })();

  inflight.set(uses, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(uses);
  }
}

function normalizeMetadata(raw: ActionMetadata): ActionMetadata {
  return {
    ...raw,
    inputs: raw.inputs ?? {},
    outputs: raw.outputs ?? {},
  };
}

/** Test-only: clear the session cache between assertions. */
export function __resetRegistryForTests(): void {
  sessionCache.clear();
  inflight.clear();
}
