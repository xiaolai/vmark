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
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parseDocument } from "yaml";
import {
  isLocalUsesRef,
  resolveLocalUsesRef,
} from "@/lib/ghaWorkflow/paths";

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
 * Read and parse a workspace-local action.yml. Pure-fs path — no
 * caching since local files change with code edits and the user
 * expects edits to action.yml to surface immediately. Returns null
 * for any failure (missing, malformed YAML, escape attempt).
 *
 * `workflowFile` and `wsRoot` are required to resolve `./` refs.
 * If either is missing the function returns null (no fallback to
 * cwd to avoid leaking arbitrary file reads).
 */
export async function getLocalActionMetadata(
  uses: string,
  workflowFile: string,
  wsRoot: string,
): Promise<ActionMetadata | null> {
  if (!isLocalUsesRef(uses)) return null;
  const resolved = resolveLocalUsesRef(uses, workflowFile, wsRoot);
  if (resolved.kind !== "action") return null;
  let text: string;
  try {
    text = await readTextFile(resolved.absPath);
  } catch {
    // Missing action.yml — try action.yaml fallback.
    if (resolved.absPath.endsWith(".yml")) {
      try {
        text = await readTextFile(
          resolved.absPath.replace(/\.yml$/, ".yaml"),
        );
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  try {
    const parsed = parseDocument(text).toJS() as
      | {
          name?: string;
          description?: string;
          author?: string;
          runs?: { using?: string };
          inputs?: Record<
            string,
            {
              description?: string;
              required?: boolean;
              default?: string | number | boolean;
              deprecationMessage?: string;
            }
          >;
          outputs?: Record<string, { description?: string }>;
        }
      | null;
    if (!parsed) return null;
    const inputs: Record<string, ActionInputSchema> = {};
    for (const [k, v] of Object.entries(parsed.inputs ?? {})) {
      inputs[k] = {
        description: v.description,
        required: v.required ?? false,
        default: v.default == null ? undefined : String(v.default),
        deprecation_message: v.deprecationMessage,
      };
    }
    const outputs: Record<string, ActionOutputSchema> = {};
    for (const [k, v] of Object.entries(parsed.outputs ?? {})) {
      outputs[k] = { description: v.description };
    }
    return normalizeMetadata({
      name: parsed.name,
      description: parsed.description,
      author: parsed.author,
      inputs,
      outputs,
      runs_using: parsed.runs?.using,
    });
  } catch {
    return null;
  }
}

/**
 * Resolve action metadata. Memoized per uses-string for the lifetime of
 * the session. Returns null in all failure modes; never throws.
 *
 * For local refs (./, ../), pass `workflowFile` + `wsRoot` to enable
 * filesystem resolution (WI-B.1); without them local refs return null.
 */
export async function getActionMetadata(
  uses: string,
  context?: { workflowFile: string; wsRoot: string },
): Promise<ActionMetadata | null> {
  // Local-action path (WI-B.1).
  if (isLocalUsesRef(uses)) {
    if (!context) return null;
    return getLocalActionMetadata(uses, context.workflowFile, context.wsRoot);
  }
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
      // Don't cache transient invoke failures — the next call should
      // be free to retry once Tauri is available again. This avoids
      // permanently disabling action-input metadata after a single
      // network or Tauri error (cross-validator audit finding).
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

    // Cache stable absences (NotFound, ParseError, InvalidUses) but
    // NOT transient failures (NetworkError) — those should retry.
    if (
      result &&
      (result.kind === "not_found" ||
        result.kind === "parse_error" ||
        result.kind === "invalid_uses")
    ) {
      sessionCache.set(uses, null);
    }
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
