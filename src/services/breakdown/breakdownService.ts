/**
 * Breakdown service (WI-1.9b) — ADR-013 services tier.
 *
 * The only writer of `breakdownStore`: pulls the live stale/diverged edge
 * list from the Rust coherence kernel (`coherence_breakdown`), appends
 * resolutions (`coherence_resolve` — WI-1.9a's append-only API), and opens
 * a downstream artifact for revision through the same window-scoped
 * open-file event the file explorer uses.
 *
 * Errors are surfaced through the store (`error`), never thrown past this
 * seam — the panel renders them; old rows are kept so a failed refresh
 * doesn't blank a list the user is working through.
 *
 * @coordinates-with src-tauri/src/coherence/commands.rs — the IPC surface
 * @coordinates-with stores/breakdownStore.ts — the mirror this writes
 * @module services/breakdown/breakdownService
 */
import { invoke } from "@tauri-apps/api/core";
import { useAiProviderStore } from "@/stores/aiStore";

import {
  useBreakdownStore,
  type ContextRow,
  type EdgeRow,
  type ProposedInput,
  type ProvenanceCandidate,
} from "@/stores/breakdownStore";
import { emitOpenFileInCurrentWindow } from "@/services/navigation/openFileEvent";

/** Mirror of the Rust `ResolveRequest` (WI-1.9a). */
export interface ResolveEdgeRequest {
  action: "accept-newer" | "waive";
  txf: string;
  input: number;
  reason?: string;
  /** D3.2: optional waiver expiry (RFC 3339). */
  expires?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Stale-response guard (audit T12): a slow refresh for workspace A must
// never overwrite rows after the user switched to workspace B (or closed
// the workspace). Each refresh takes a generation ticket; only the
// newest writes.
let refreshGeneration = 0;

/**
 * Join a workspace-relative path onto the workspace root. Pure — no
 * platform path module: Tauri accepts forward slashes on every platform,
 * so only a trailing separator on the root needs normalizing.
 */
export function resolveWorkspacePath(workspaceRoot: string, relative: string): string | null {
  // Ledger data crosses a trust boundary (audit T13): refuse traversal
  // segments, absolute paths, and backslashes before opening anything.
  if (relative.length === 0 || relative.startsWith("/") || relative.includes("\\")) return null;
  const segments = relative.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return `${workspaceRoot.replace(/[/\\]+$/, "")}/${relative}`;
}

/**
 * Pull-based refresh (R15): reconcile + project on the Rust side, then
 * mirror the rows. Loading is set before the invoke and always cleared;
 * a failure writes `error` and keeps the previous rows.
 */
export async function refreshBreakdown(workspaceRoot: string): Promise<void> {
  const generation = ++refreshGeneration;
  const store = useBreakdownStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    const context = useBreakdownStore.getState().selectedContext;
    const rows = await invoke<EdgeRow[]>("coherence_breakdown", {
      workspaceRoot,
      context,
    });
    if (generation !== refreshGeneration) return; // superseded (audit T12)
    useBreakdownStore.getState().setRows(rows);
  } catch (error) {
    if (generation !== refreshGeneration) return;
    useBreakdownStore.getState().setError(messageOf(error));
  } finally {
    if (generation === refreshGeneration) {
      useBreakdownStore.getState().setLoading(false);
    }
  }
}

/**
 * Append a ratification (`accept-newer`) or waiver (`waive`) for one edge,
 * then refresh so the resolved edge drops out of the list. A rejection
 * (multi-head, missing waiver reason, unknown edge) lands in `error`
 * without refreshing — the stale list is still accurate.
 */
export async function resolveEdge(
  workspaceRoot: string,
  request: ResolveEdgeRequest,
): Promise<void> {
  try {
    await invoke("coherence_resolve", { workspaceRoot, request });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/**
 * "Revise" — open the downstream artifact in this window's editor (same
 * mechanism as the file explorer: the window-scoped open-file event).
 * Revising produces a new downstream revision, which retires the stale
 * edge per spec §9.2 edge liveness.
 */
export async function reviseEdge(
  workspaceRoot: string,
  downstreamPath: string,
): Promise<void> {
  const resolved = resolveWorkspacePath(workspaceRoot, downstreamPath);
  if (resolved === null) {
    useBreakdownStore.getState().setError(`invalid artifact path: ${downstreamPath}`);
    return;
  }
  try {
    await emitOpenFileInCurrentWindow(resolved);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/**
 * Run a pull-only semantic check on one edge (WI-2b.4/2b.5, D5.1) with
 * the active AI provider, then refresh so the axis-2 badge appears.
 * No active provider is a surfaced store error, not a throw.
 */
export async function checkEdge(
  workspaceRoot: string,
  txf: string,
  input: number,
): Promise<void> {
  const ai = useAiProviderStore.getState();
  const active = ai.activeProvider;
  if (!active) {
    useBreakdownStore.getState().setError("no-active-provider");
    return;
  }
  const rest = ai.restProviders.find((p) => p.type === active);
  const cli = ai.cliProviders.find((p) => p.type === active);
  try {
    await invoke("coherence_check", {
      workspaceRoot,
      txf,
      input,
      provider: {
        provider: active,
        apiKey: rest?.apiKey || null,
        endpoint: rest?.endpoint || null,
        cliPath: cli?.path || null,
      },
      model: null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/** WI-2b.7: load the context set (implicit default always present). */
export async function refreshContexts(workspaceRoot: string): Promise<void> {
  try {
    const contexts = await invoke<ContextRow[]>("coherence_contexts", {
      workspaceRoot,
    });
    useBreakdownStore.getState().setContexts(contexts);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** Create a named greenhouse context (D1.4 — enforcement is opt-in later). */
export async function createContext(
  workspaceRoot: string,
  name: string,
): Promise<void> {
  try {
    await invoke("coherence_context_create", {
      workspaceRoot,
      name,
      parent: null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
}

/**
 * Flip enforcement. The EXPLICIT human confirmation (D4.3) must happen
 * at the call site before this runs — this seam only records it.
 */
export async function setContextEnforcement(
  workspaceRoot: string,
  context: string,
  enforcing: boolean,
): Promise<void> {
  try {
    await invoke("coherence_context_enforce", {
      workspaceRoot,
      context,
      enforcing,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
}

/** WI-3.2: refresh the orphaned-but-recoverable candidates (pull-only). */
export async function refreshProvenance(workspaceRoot: string): Promise<void> {
  try {
    const candidates = await invoke<ProvenanceCandidate[]>(
      "coherence_provenance_candidates",
      { workspaceRoot },
    );
    useBreakdownStore.getState().setProvenance(candidates);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** Fetch the proposal for one candidate — head token + proposed inputs. */
export async function proposeInputs(
  workspaceRoot: string,
  path: string,
): Promise<{ head: string; inputs: ProposedInput[] } | null> {
  try {
    return await invoke<{ head: string; inputs: ProposedInput[] }>(
      "coherence_propose_inputs",
      { workspaceRoot, path },
    );
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return null;
  }
}

/**
 * Append the provenance-confirmation (idem minted here, once per
 * logical confirm — retries reuse it), then refresh both surfaces.
 */
export async function confirmInputs(
  workspaceRoot: string,
  path: string,
  head: string,
  inputs: ProposedInput[],
): Promise<void> {
  try {
    await invoke("coherence_confirm_inputs", {
      workspaceRoot,
      request: { path, head, inputs, idem: crypto.randomUUID() },
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshProvenance(workspaceRoot);
  await refreshBreakdown(workspaceRoot);
}
