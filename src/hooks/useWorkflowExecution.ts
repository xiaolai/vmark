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
 * @coordinates-with workflowPreviewStore.ts — writes executionId + stepStatuses
 * @coordinates-with workflowApprovalStore.ts — surfaces pending approvals
 * @coordinates-with src-tauri/src/workflow/commands.rs — invoke targets
 * @module hooks/useWorkflowExecution
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";

import { useAiProviderStore } from "@/stores/aiProviderStore";
import {
  useWorkflowApprovalStore,
  type ApprovalRequestPayload,
} from "@/stores/workflowApprovalStore";
import { useWorkflowPreviewStore } from "@/stores/workflowPreviewStore";

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
  status: "completed" | "failed" | "cancelled";
}

export interface RunOptions {
  /** YAML body of the workflow file. */
  yaml: string;
  /** Workspace root for path validation in action steps. */
  workspaceRoot: string;
  /** Optional env vars passed to ${VAR} / ${{ env.X }} resolution. */
  env?: Record<string, string>;
}

export function useWorkflowExecution() {
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const subscribeOnce = useCallback(async () => {
    if (unlistenersRef.current.length > 0) return;

    const previewStore = useWorkflowPreviewStore;
    const approvalStore = useWorkflowApprovalStore;

    const stepUnlisten = await listen<StepUpdateEvent>(
      "workflow:step-update",
      (e) => {
        const current = previewStore.getState().executionId;
        if (current && e.payload.executionId !== current) return;
        previewStore.getState().setStepStatus(e.payload.stepId, {
          status: e.payload.status,
          output: e.payload.output,
          error: e.payload.error,
          duration: e.payload.duration,
        });
      },
    );

    const completeUnlisten = await listen<CompleteEvent>(
      "workflow:complete",
      (e) => {
        const current = previewStore.getState().executionId;
        if (current && e.payload.executionId !== current) return;
        previewStore.getState().setExecution(null);
        // Dismiss any pending approval dialog — once the workflow is over
        // the user shouldn't be prompted for a step that no longer matters.
        const pending = approvalStore.getState().pending;
        if (pending && pending.executionId === e.payload.executionId) {
          approvalStore.getState().dismiss();
        }
      },
    );

    const approvalUnlisten = await listen<ApprovalRequestPayload>(
      "workflow:approval-request",
      (e) => {
        const current = previewStore.getState().executionId;
        if (current && e.payload.executionId !== current) return;
        approvalStore.getState().enqueue(e.payload);
      },
    );

    unlistenersRef.current = [stepUnlisten, completeUnlisten, approvalUnlisten];
  }, []);

  useEffect(() => {
    void subscribeOnce();
    return () => {
      for (const fn of unlistenersRef.current) {
        try {
          fn();
        } catch {
          // listener already cleaned up
        }
      }
      unlistenersRef.current = [];
    };
  }, [subscribeOnce]);

  const start = useCallback(async ({ yaml, workspaceRoot, env }: RunOptions) => {
    const state = useAiProviderStore.getState();
    const active = state.activeProvider;
    let providerPayload: {
      provider: string;
      apiKey: string | null;
      endpoint: string | null;
      cliPath: string | null;
    } | null = null;
    if (active) {
      const rest = state.restProviders.find((p) => p.type === active);
      const cli = state.cliProviders.find((p) => p.type === active);
      providerPayload = {
        provider: active,
        apiKey: rest?.apiKey || null,
        endpoint: rest?.endpoint || null,
        cliPath: cli?.path || null,
      };
    }

    // Pre-generate the execution ID and register it with the store BEFORE
    // invoking the runner. This closes the race where step-update / complete
    // events for fast-finishing workflows arrive before invoke() resolves
    // and get filtered out (or wipe valid status by clearing stepStatuses).
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    useWorkflowPreviewStore.getState().setExecution(id);

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
      // until the next workflow starts. Re-throw so the caller can surface it.
      useWorkflowPreviewStore.getState().setExecution(null);
      throw err;
    }
  }, []);

  const cancel = useCallback(async () => {
    const id = useWorkflowPreviewStore.getState().executionId;
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
