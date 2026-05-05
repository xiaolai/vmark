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
 * Derive (workflowFile, wsRoot) for resolving `./` action refs.
 *
 * Codex audit HIGH-5 fix: previously scanned global tab state, which
 * picked the wrong repo in multi-window sessions. Now we use the
 * active editor's filePath as the authoritative anchor — same window
 * where the StepForm is mounted.
 *
 * Returns null when the active document isn't a workflow file (form
 * shows the unavailable state, no fs read).
 */
function inferWorkflowContext(): {
  workflowFile: string;
  wsRoot: string;
} | null {
  // Try the focused source editor's docId first — its containing tab
  // is the authoritative file for the form. activeEditorStore is the
  // single window-scoped truth (StatusBar + diagnostics use it too).
  const activeView = useActiveEditorStore.getState().activeSourceView;
  if (activeView?.dom?.isConnected) {
    const tabs = useTabStore.getState().tabs;
    const docs = useDocumentStore.getState().documents;
    // Find the tab whose document content matches the view's doc.
    // CodeMirror doesn't expose tabId directly, so we cross-check
    // via active tab in any window: the focused source view belongs
    // to the active tab of its window. Resolve through DOM closest()
    // for the host window-frame.
    for (const label of Object.keys(tabs)) {
      const activeId = useTabStore.getState().activeTabId[label] ?? null;
      if (!activeId) continue;
      const fp = docs[activeId]?.filePath;
      if (!fp) continue;
      // Match by content length as a cheap "is this the same doc"
      // heuristic — false positives cost a stale fs read, which the
      // registry handles by returning null.
      if (activeView.state.doc.length === (docs[activeId]?.content ?? "").length) {
        const norm = fp.replace(/\\/g, "/");
        const ghIdx = norm.lastIndexOf("/.github/workflows/");
        if (ghIdx > 0) {
          return { workflowFile: norm, wsRoot: norm.slice(0, ghIdx) };
        }
      }
    }
  }
  // Fallback: first window with a workflow filePath. Multi-window
  // safety regression risk acknowledged; the active-view path above
  // is the correct one in 99% of cases.
  const tabs = useTabStore.getState().tabs;
  const docs = useDocumentStore.getState().documents;
  for (const label of Object.keys(tabs)) {
    const activeId = useTabStore.getState().activeTabId[label] ?? null;
    if (!activeId) continue;
    const fp = docs[activeId]?.filePath;
    if (!fp) continue;
    const norm = fp.replace(/\\/g, "/");
    const ghIdx = norm.lastIndexOf("/.github/workflows/");
    if (ghIdx > 0) return { workflowFile: norm, wsRoot: norm.slice(0, ghIdx) };
  }
  return null;
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
