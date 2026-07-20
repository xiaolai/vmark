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
import { useSettingsStore } from "@/stores/settingsStore";

import {
  useBreakdownStore,
  type BranchCandidate,
  type ContextRow,
  type MergeNotice,
  type EdgeRow,
  type LogbookView,
} from "@/stores/breakdownStore";
import { emitOpenFileInCurrentWindow } from "@/services/navigation/openFileEvent";
import {
  isActiveWorkspace,
  isLatestRefresh,
  takeRefreshTicket,
} from "./refreshGuards";

// Re-exported so existing consumers (semanticActs, claimService) keep
// importing the guards from this module.
export { isActiveWorkspace, isLatestRefresh, takeRefreshTicket };

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
  // Never refresh a workspace the user has already left: a stale caller
  // (e.g. a mutation completing after a switch) must not consume a ticket
  // and thereby starve the active workspace's refresh (audit #4/#5).
  if (!isActiveWorkspace(workspaceRoot)) return;
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
    if (generation !== refreshGeneration || !isActiveWorkspace(workspaceRoot))
      return; // superseded (audit T12) or workspace changed (D1)
    useBreakdownStore.getState().setRows(rows);
  } catch (error) {
    if (generation !== refreshGeneration || !isActiveWorkspace(workspaceRoot))
      return; // stale error must not surface on the new workspace (D1–D5)
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
      // Owner-configurable confidence threshold. Sent explicitly so the setting
      // actually reaches the checker; omitting it silently falls back to 0.9.
      tau: useSettingsStore.getState().general.coherenceCheckTau ?? null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/** WI-2b.7: load the context set (implicit default always present). */
export async function refreshContexts(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("contexts");
  try {
    const contexts = await invoke<ContextRow[]>("coherence_contexts", {
      workspaceRoot,
    });
    if (!isLatestRefresh("contexts", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setContexts(contexts);
  } catch (error) {
    if (!isLatestRefresh("contexts", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
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

/** WI-3.6: the pull-only branch-context candidate for the current branch. */
export async function refreshBranchCandidate(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("branch");
  try {
    const candidate = await invoke<BranchCandidate | null>(
      "coherence_branch_candidate",
      { workspaceRoot },
    );
    if (!isLatestRefresh("branch", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setBranchCandidate(candidate);
  } catch (error) {
    if (!isLatestRefresh("branch", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** WI-3.6: create a context mapped to the current branch (explicit act). */
export async function createContextFromBranch(workspaceRoot: string): Promise<void> {
  try {
    await invoke("coherence_context_from_branch", { workspaceRoot });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
  await refreshBranchCandidate(workspaceRoot);
}

/** WI-3.7: the latest completed-merge notice for the dismissible banner. */
export async function refreshMergeNotice(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("merge");
  try {
    const notice = await invoke<MergeNotice | null>("coherence_recent_merge", {
      workspaceRoot,
    });
    if (!isLatestRefresh("merge", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setMergeNotice(notice);
  } catch (error) {
    if (!isLatestRefresh("merge", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/**
 * Mark a document FROZEN (finished history) or back to LIVE.
 *
 * Measured motivation (2026-07-20): M2 read 0 relevant / 5 noise, and every
 * flag had the same cause — the downstream was already finished. Freezing stops
 * the interruption; the edge and its provenance stay recorded.
 *
 * Human-only by design: the layer may SUGGEST a freeze, never apply one.
 */
export async function setDocumentLifecycle(
  workspaceRoot: string,
  object: string,
  lifecycle: "live" | "frozen",
  reason?: string,
): Promise<void> {
  try {
    await invoke("coherence_set_lifecycle", {
      workspaceRoot,
      object,
      lifecycle,
      reason: reason ?? null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/**
 * Anchor an edge to a heading path — pass an EMPTY array to clear it and
 * restore whole-file behaviour. An anchored edge asks "did the part I depend on
 * change?" instead of "did the file change?".
 */
/**
 * The heading paths this edge's upstream can be anchored to.
 *
 * Backed by the same text `setEdgeAnchor` validates against, so a path this
 * returns is one the setter will accept — the picker never offers an option
 * that would be rejected.
 */
export async function fetchEdgeHeadings(
  workspaceRoot: string,
  txf: string,
  input: number,
): Promise<string[][] | null> {
  try {
    return await invoke<string[][]>("coherence_edge_headings", {
      workspaceRoot,
      txf,
      input,
    });
  } catch (error) {
    // `null` on failure, NOT `[]`: an empty array is the legitimate "this
    // upstream has no anchorable sections" answer, and collapsing an error into
    // it would render a false "No sections to anchor to" for a diverged upstream
    // or a real IO failure.
    useBreakdownStore.getState().setError(messageOf(error));
    return null;
  }
}

export async function setEdgeAnchor(
  workspaceRoot: string,
  txf: string,
  input: number,
  headings: string[],
): Promise<void> {
  try {
    await invoke("coherence_set_anchor", { workspaceRoot, txf, input, headings });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/**
 * Record whether surfacing this flag was worth the interruption (the M2 datum).
 * Revisable: a later judgment supersedes, and both stay in history.
 */
export async function judgeFlag(
  workspaceRoot: string,
  txf: string,
  input: number,
  judgment: "relevant" | "noise" | "unsure",
  note?: string,
): Promise<void> {
  try {
    await invoke("coherence_flag_judgment", {
      workspaceRoot,
      txf,
      input,
      judgment,
      note: note ?? null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/**
 * Read the coherence logbook — a projection over the ledger, so it works
 * retroactively on history recorded before the logbook existed. Read-only.
 */
export async function fetchLogbook(workspaceRoot: string): Promise<LogbookView | null> {
  try {
    return await invoke<LogbookView>("coherence_logbook", { workspaceRoot });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return null;
  }
}
