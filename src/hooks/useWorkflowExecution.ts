/**
 * useWorkflowExecution
 *
 * Purpose: Owns the lifecycle of a `.yml` workflow run — invokes the
 * `run_workflow` Tauri command, listens for `workflow:step-update`,
 * `workflow:complete`, and `workflow:approval-request` events, and writes
 * status into `workflowPreviewStore`.
 *
 * One active execution per window. Cancellation calls `cancel_workflow`.
 * Approval requests bubble into `workflowApprovalStore` so the dialog
 * component can render them; the user's verdict goes back through the
 * `respond_workflow_approval` command.
 *
 * Four properties the audit round 2 pinned, each with a defect behind it:
 *   - Subscription is ATOMIC and TRANSACTIONAL (#763, #764, #768). The
 *     unlisteners ref stays empty across three awaits, so an in-flight promise
 *     is the claim; a rejection rolls back every listener already acquired; and
 *     a registration that finishes after unmount drops itself.
 *   - Every event is matched against the CURRENT execution id by exact,
 *     non-null equality (#765, #1003). The old `current && …` predicate
 *     accepted EVERY event once the id was back to null, so a late frame from a
 *     finished run repopulated its statuses and re-raised its approvals.
 *   - Completion PRESERVES the run's results and records how it ended (#767),
 *     through `finishExecution` rather than `setExecution(null)` — which wiped
 *     every step status at the moment the user wanted to read them.
 *   - A start neither races the listeners (#769 — it awaits the same
 *     subscription promise the mount effect started) nor steals a live run's
 *     registration (#770 — a second start is REFUSED before the store is
 *     touched, so the running workflow keeps its id, its events stay routable,
 *     and this call's rollback cannot clear it).
 *
 * @coordinates-with services/workflow/providerPayload.ts — the shared run_workflow provider block
 * @coordinates-with stores/workflowStore.ts — writes executionId + stepStatuses, surfaces pending approvals
 * @coordinates-with src-tauri/src/workflow/commands.rs — invoke targets
 * @module hooks/useWorkflowExecution
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";

import { workflowError } from "@/utils/debug";
import { workflowProviderPayload } from "@/services/workflow/providerPayload";
import {
  useWorkflowStore,
  type ApprovalRequestPayload,
  type WorkflowRunOutcome,
} from "@/stores/workflowStore";

interface StepUpdateEvent {
  executionId: string;
  stepId: string;
  status: "running" | "success" | "error" | "skipped";
  output?: string;
  error?: string;
  duration?: number;
}

interface CompleteEvent {
  executionId: string;
  /** ONE definition, shared with the store's `lastRunOutcome`: the terminal
   *  vocabulary must not be able to drift between the wire and the state. */
  status: WorkflowRunOutcome;
}

export interface RunOptions {
  /** YAML body of the workflow file. */
  yaml: string;
  /** Workspace root for path validation in action steps. */
  workspaceRoot: string;
  /** Optional env vars passed to ${VAR} / ${{ env.X }} resolution. */
  env?: Record<string, string>;
}

/**
 * Whether an event belongs to the run this window is currently executing.
 *
 * EXACT, non-null equality (audit #765). The old predicate — "reject only when
 * a current id exists and differs" — accepted every event while no run was
 * registered, which is precisely the state a finished run leaves behind: a late
 * step-update then recreated its statuses, and a late approval-request re-raised
 * a dialog for a workflow that was over.
 */
function isCurrentExecution(executionId: string): boolean {
  return useWorkflowStore.getState().preview.executionId === executionId;
}

/** Drop a set of listeners, tolerating one that is already gone. */
function releaseListeners(fns: readonly UnlistenFn[]): void {
  for (const fn of fns) {
    try {
      fn();
    } catch {
      // listener already cleaned up
    }
  }
}

export function useWorkflowExecution() {
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  // The in-flight registration. The ref above stays EMPTY across three awaits,
  // so it cannot serve as the claim: StrictMode's setup/cleanup/setup, or any
  // second caller, would pass the "already subscribed" check and register a
  // duplicate set whose predecessor is then overwritten and leaked (#763).
  const subscribingRef = useRef<Promise<void> | null>(null);

  const subscribeOnce = useCallback(
    (isCancelled: () => boolean = () => false): Promise<void> => {
      if (unlistenersRef.current.length > 0) return Promise.resolve();
      if (subscribingRef.current) return subscribingRef.current;

      const store = useWorkflowStore;
      const acquired: UnlistenFn[] = [];
      const run = (async () => {
        try {
          acquired.push(
            await listen<StepUpdateEvent>("workflow:step-update", (e) => {
              if (!isCurrentExecution(e.payload.executionId)) return;
              // Only the facts this event actually reports. A running step has no
              // duration and no error yet; writing those keys as `undefined` would
              // make the entry claim the runner had reported them empty.
              store.getState().setStepStatus(e.payload.stepId, {
                status: e.payload.status,
                ...(e.payload.output !== undefined ? { output: e.payload.output } : {}),
                ...(e.payload.error !== undefined ? { error: e.payload.error } : {}),
                ...(e.payload.duration !== undefined ? { duration: e.payload.duration } : {}),
              });
            }),
          );

          acquired.push(
            await listen<CompleteEvent>("workflow:complete", (e) => {
              if (!isCurrentExecution(e.payload.executionId)) return;
              // Records HOW it ended and keeps the step results (#767).
              store.getState().finishExecution(e.payload.executionId, e.payload.status);
              // Dismiss any pending approval dialog — once the workflow is over
              // the user shouldn't be prompted for a step that no longer matters.
              // Scoped to the request it is dismissing, so a step whose approval
              // arrived between the verdict and this frame is not silently wiped.
              const pending = store.getState().approval.pending;
              if (pending && pending.executionId === e.payload.executionId) {
                store.getState().dismissApproval(pending);
              }
            }),
          );

          acquired.push(
            await listen<ApprovalRequestPayload>("workflow:approval-request", (e) => {
              if (!isCurrentExecution(e.payload.executionId)) return;
              store.getState().enqueueApproval(e.payload);
            }),
          );

          // Unmounted while registering (#768): the cleanup already ran and saw
          // an empty ref, so these listeners have to drop themselves or they
          // stay live for the process's lifetime with nothing holding them.
          if (isCancelled()) {
            releaseListeners(acquired);
            return;
          }
          unlistenersRef.current = acquired;
        } catch (error) {
          // TRANSACTIONAL (#764): a rejection from the second or third `listen`
          // used to leave the earlier ones installed and unreachable, and the
          // caller's `void` call turned the rejection into an unhandled one.
          releaseListeners(acquired);
          workflowError("Failed to subscribe to workflow events:", error);
        } finally {
          subscribingRef.current = null;
        }
      })();
      subscribingRef.current = run;
      return run;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void subscribeOnce(() => cancelled);
    return () => {
      cancelled = true;
      releaseListeners(unlistenersRef.current);
      unlistenersRef.current = [];
    };
  }, [subscribeOnce]);

  const start = useCallback(
    async ({ yaml, workspaceRoot, env }: RunOptions) => {
      // Listeners first (#769). A fast workflow can emit step-update and
      // complete before `invoke` resolves; the pre-generated id below makes
      // those events ROUTABLE, but only if something is listening for them.
      await subscribeOnce();

      // ONE derivation, shared with the workflow-genie path (audit #762).
      const providerPayload = workflowProviderPayload();

      // Pre-generate the execution ID and register it with the store BEFORE
      // invoking the runner. This closes the race where step-update / complete
      // events for fast-finishing workflows arrive before invoke() resolves
      // and get filtered out (or wipe valid status by clearing stepStatuses).
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // ONE run per window, refused BEFORE the store is touched (audit #770).
      // Overwriting a live registration made the running workflow's own events
      // unroutable, and this call's rollback — which the backend's concurrency
      // guard makes the likely outcome — then cleared the store out from under
      // it. The panel disables Run while a run is registered, so reaching this
      // is a programming error, not a user one; the caller logs it.
      if (useWorkflowStore.getState().preview.executionId !== null) {
        throw new Error("A workflow is already running in this window");
      }
      useWorkflowStore.getState().setExecution(id);

      try {
        const returnedId = await invoke<string>("run_workflow", {
          yaml,
          env: env ?? {},
          workspaceRoot,
          provider: providerPayload,
          executionId: id,
        });
        return returnedId;
      } catch (err) {
        // invoke() rejected (concurrency guard, parse error, missing workspace).
        // Roll the store back so the UI doesn't show a fake "running" state
        // until the next workflow starts — only while the store still holds THIS
        // execution (audit #374): a run registered after this one — the genie
        // path writes the same slot — must not be wiped by its failure.
        // Re-throw so the caller can surface it.
        const store = useWorkflowStore.getState();
        if (store.preview.executionId === id) store.setExecution(null);
        throw err;
      }
    },
    [subscribeOnce],
  );

  const cancel = useCallback(async () => {
    const id = useWorkflowStore.getState().preview.executionId;
    if (!id) return;
    await invoke("cancel_workflow", { executionId: id });
  }, []);

  const respondApproval = useCallback(
    async (executionId: string, stepId: string, approved: boolean) => {
      await invoke("respond_workflow_approval", {
        executionId,
        stepId,
        approved,
      });
    },
    [],
  );

  return { start, cancel, respondApproval };
}
