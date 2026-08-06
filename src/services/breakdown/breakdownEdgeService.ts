/**
 * Purpose: per-edge operations — resolve, revise, semantic check, anchor, and the M2 flag judgment.
 *
 * Split out of breakdownService.ts for size. Everything here acts on ONE edge;
 * the panel-wide refreshes stay in breakdownRefresh.ts.
 *
 * @coordinates-with src/services/breakdown/breakdownService.ts — re-exports these
 * @module services/breakdown/breakdownEdgeService
 */
import {
  invoke,
} from "@tauri-apps/api/core";
import {
  useAiProviderStore,
} from "@/stores/aiStore";
import {
  useSettingsStore,
} from "@/stores/settingsStore";

import {
  useBreakdownStore,
} from "@/stores/breakdownStore";
import {
  emitOpenFileInCurrentWindow,
} from "@/services/navigation/openFileEvent";
import { messageOf, resolveWorkspacePath } from "./breakdownShared";
import { refreshBreakdown } from "./breakdownRefresh";
import type { ResolveEdgeRequest } from "./breakdownService";

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
