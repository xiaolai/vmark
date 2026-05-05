/**
 * Purpose: React hook that resolves an action `uses:` reference to
 *   typed metadata (name, description, inputs, outputs) via the Phase 6
 *   action registry. Wraps the async `getActionMetadata` call with the
 *   states the form needs to render: idle, loading, success, unavailable.
 *
 *   Idle = unparseable uses (./local, docker://, missing @ref) or no
 *   uses at all (run-step). The form skips its metadata UI in that
 *   case — there is nothing to fetch.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
 *   §6 Phase 9 / WI-6.2 — tooltip preview consumer.
 *
 * Key decisions:
 *   - Cancellation via a mounted-flag, not AbortController, because the
 *     underlying registry has its own session memo and inflight dedup;
 *     a stale promise resolving after unmount is harmless and there is
 *     no user-side cost to reordering.
 *   - Failure modes collapse to a single `unavailable` state. The form
 *     renders the same fallback (free-form key/value rows) for all of
 *     them; distinguishing NotFound vs NetworkError in the UI is
 *     out-of-scope polish.
 *
 * @coordinates-with src/lib/ghaWorkflow/actions/registry.ts — async metadata source
 * @module components/Editor/WorkflowEditor/useActionMetadata
 */

import { useContext, useEffect, useState } from "react";
import {
  getActionMetadata,
  parseUsesRef,
  type ActionMetadata,
} from "@/lib/ghaWorkflow/actions/registry";
import { isLocalUsesRef } from "@/lib/ghaWorkflow/paths";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { WindowContext } from "@/contexts/WindowContext";

/**
 * Derive (workflowFile, wsRoot) for resolving `./` action refs.
 *
 * Codex audit HIGH-5 final fix: strictly window-scoped via
 * `useWindowLabel()` from WindowContext. We read ONLY the active
 * tab of the current window — no global scan, no doc-length
 * heuristic. Multi-window safe by construction because the hook
 * runs inside StepForm which is mounted inside the side panel of
 * a specific window's WindowProvider.
 *
 * Returns null when the current window's active tab has no filePath
 * under `.github/workflows/` (form shows the unavailable state).
 */
function useWorkflowContext(): {
  workflowFile: string;
  wsRoot: string;
} | null {
  // Use the safe variant of WindowContext lookup — useWindowLabel
  // throws when no provider is present, which breaks unit tests of
  // dependent components. Tests run without WindowProvider; in that
  // case we return null (no metadata) which exactly matches the
  // "no workflow context" branch the form already handles.
  const context = useContext(WindowContext);
  const windowLabel = context?.windowLabel ?? null;
  const activeTabId = useTabStore((s) =>
    windowLabel ? s.activeTabId[windowLabel] ?? null : null,
  );
  const filePath = useDocumentStore((s) =>
    activeTabId ? s.documents[activeTabId]?.filePath ?? null : null,
  );
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/");
  const ghIdx = norm.lastIndexOf("/.github/workflows/");
  if (ghIdx <= 0) return null;
  return { workflowFile: norm, wsRoot: norm.slice(0, ghIdx) };
}

export type ActionMetadataState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; metadata: ActionMetadata }
  | { state: "unavailable" };

function isResolvableRef(uses: string): boolean {
  // Remote ref (owner/repo@ref) → handled by Rust registry.
  if (parseUsesRef(uses)) return true;
  // Local ref (./, ../) → handled by getLocalActionMetadata.
  if (isLocalUsesRef(uses)) return true;
  return false;
}

export function useActionMetadata(
  uses: string | undefined,
): ActionMetadataState {
  // Window-scoped context — read at the hook's call site so it's
  // bound to the StepForm's window, not a global.
  const ctx = useWorkflowContext();
  const isLocalCtx = uses && isLocalUsesRef(uses) ? ctx : null;

  const [result, setResult] = useState<ActionMetadataState>(() =>
    uses && isResolvableRef(uses)
      ? { state: "loading" }
      : { state: "idle" },
  );

  useEffect(() => {
    if (!uses || !isResolvableRef(uses)) {
      setResult({ state: "idle" });
      return;
    }
    setResult({ state: "loading" });

    let mounted = true;
    const fetchPromise = isLocalCtx
      ? getActionMetadata(uses, isLocalCtx)
      : getActionMetadata(uses);
    fetchPromise
      .then((metadata) => {
        if (!mounted) return;
        if (metadata) {
          setResult({ state: "success", metadata });
        } else {
          setResult({ state: "unavailable" });
        }
      })
      .catch(() => {
        // The registry already swallows errors and returns null in
        // every documented failure mode, but a future refactor that
        // forgets the try/catch would surface as an unhandled rejection
        // here. Belt-and-braces: collapse to "unavailable".
        if (mounted) setResult({ state: "unavailable" });
      });
    return () => {
      mounted = false;
    };
  }, [uses]);

  return result;
}
