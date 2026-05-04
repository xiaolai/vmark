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

export type ActionMetadataState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; metadata: ActionMetadata }
  | { state: "unavailable" };

export function useActionMetadata(
  uses: string | undefined,
): ActionMetadataState {
  const [result, setResult] = useState<ActionMetadataState>(() =>
    uses && parseUsesRef(uses)
      ? { state: "loading" }
      : { state: "idle" },
  );

  useEffect(() => {
    if (!uses || !parseUsesRef(uses)) {
      setResult({ state: "idle" });
      return;
    }
    setResult({ state: "loading" });

    let mounted = true;
    getActionMetadata(uses).then((metadata) => {
      if (!mounted) return;
      if (metadata) {
        setResult({ state: "success", metadata });
      } else {
        setResult({ state: "unavailable" });
      }
    });
    return () => {
      mounted = false;
    };
  }, [uses]);

  return result;
}
