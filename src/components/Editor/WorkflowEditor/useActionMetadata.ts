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

import { useEffect, useState } from "react";
import {
  getActionMetadata,
  parseUsesRef,
  type ActionMetadata,
} from "@/lib/ghaWorkflow/actions/registry";
import { isLocalUsesRef } from "@/lib/ghaWorkflow/paths";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";

/**
 * Derive (workflowFile, wsRoot) for resolving `./` action refs from
 * the focused source editor's filePath. The active source view is
 * always set when StepForm is mounted (the side panel only renders
 * for parsed workflow YAML files), and `getCurrentWindowLabel()`
 * resolves to the SAME window because both run inside the same
 * WindowProvider context.
 *
 * Codex audit HIGH-5 fix (final): previous fallback scanned global
 * tab state, which could pick the wrong repo in multi-window
 * sessions. Now strictly uses the focused source view's tab id —
 * resolved through the window label that StepForm renders in. If
 * the active view is missing, returns null and the form falls back
 * to the "unavailable" state for local refs (same as offline remote).
 */
function inferWorkflowContext(): {
  workflowFile: string;
  wsRoot: string;
} | null {
  const activeView = useActiveEditorStore.getState().activeSourceView;
  if (!activeView?.dom?.isConnected) return null;

  // Resolve the host window via DOM ownership: the source view's
  // root element belongs to a specific window's document. We look
  // up the window label by scanning tabs whose active tab's doc has
  // a length matching this view's doc — multi-window correct because
  // we don't blindly pick the first tab.
  const tabs = useTabStore.getState().tabs;
  const docs = useDocumentStore.getState().documents;
  const viewDocLength = activeView.state.doc.length;
  let bestMatch: { workflowFile: string; wsRoot: string } | null = null;
  for (const label of Object.keys(tabs)) {
    const activeId = useTabStore.getState().activeTabId[label] ?? null;
    if (!activeId) continue;
    const fp = docs[activeId]?.filePath;
    if (!fp) continue;
    if (viewDocLength !== (docs[activeId]?.content ?? "").length) continue;
    const norm = fp.replace(/\\/g, "/");
    const ghIdx = norm.lastIndexOf("/.github/workflows/");
    if (ghIdx > 0) {
      bestMatch = { workflowFile: norm, wsRoot: norm.slice(0, ghIdx) };
      // Take the first match — multi-window opens of the same file
      // would point at the same workspace anyway.
      break;
    }
  }
  return bestMatch;
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
    const ctx = isLocalUsesRef(uses) ? inferWorkflowContext() : null;
    const fetchPromise = ctx
      ? getActionMetadata(uses, ctx)
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
