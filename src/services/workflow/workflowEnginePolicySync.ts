/**
 * Push `advanced.workflowEngine` to the Rust runner (WI-19).
 *
 * Purpose: the backend cannot read the flag. Settings persist to the webview's
 * localStorage (zustand `persist` over `createSafeStorage`), so before this
 * service `run_workflow` was registered unconditionally and executed whatever
 * YAML reached the IPC boundary — the flag hid a button and nothing else.
 * Rust now starts fail-closed (`WorkflowRunnerState::engine_enabled` = false)
 * and this is what opens the gate.
 *
 * Same shape as `services/browser/browserAiPolicySync.ts`, deliberately: the
 * embedded browser solved this exact problem first, and one mechanism for
 * "the webview owns the flag, Rust enforces it" is easier to keep honest than
 * two.
 *
 * Key decisions:
 *   - **Push at bootstrap even when the flag is off.** Rust's default already
 *     says off, but the contract is "Rust matches the store", not "…except at
 *     startup", and a later change is only meaningful against a known baseline.
 *   - **Push in BOTH directions.** A one-way latch would leave the runner armed
 *     for the rest of the session after the user switches the engine off.
 *   - **The two directions do NOT fail the same way** (audit 20260804-F11).
 *     A failed ENABLE fails closed: Rust stays off, the feature is merely
 *     unavailable, and a warning is the right response. A failed DISABLE fails
 *     OPEN — the runner stays armed after the user asked for it to stop, which
 *     is the security posture inverted. Both used to be one fire-and-forget
 *     `void invoke().catch(warn)`, so a rejected disable left the engine
 *     running with a line in a log file the user will never read. A disable is
 *     now RETRIED with backoff and, if it still fails, said out loud.
 *   - **Updates are SERIALIZED.** They were fire-and-forget, so a rapid
 *     off→on could be delivered in either order and Rust would settle on the
 *     wrong one. A queue makes the last push the last write. A retry loop that
 *     an intervening change has made obsolete is abandoned rather than
 *     completed — nobody wants the disable retry to undo a fresh enable.
 *
 * @coordinates-with src-tauri/src/workflow/guards.rs — the gate this feeds
 * @coordinates-with src/hooks/useCommandBootstrap.ts — mounts it once per window
 * @module services/workflow/workflowEnginePolicySync
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useSettingsStore } from "@/stores/settingsStore";
import { workflowWarn } from "@/utils/debug";

/** Attempts for a DISABLE. One try is what left the runner armed. */
const MAX_DISABLE_ATTEMPTS = 3;
/** First backoff step; doubles per attempt (250ms, 500ms). */
const RETRY_BASE_MS = 250;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Mount once with the document-window command bootstrap. Returns a cleanup. */
export function startWorkflowEnginePolicySync(): () => void {
  let stopped = false;
  /** The state the store last asked for. A retry for anything else is stale. */
  let desired = useSettingsStore.getState().advanced.workflowEngine ?? false;
  /** Tail of the serialized push chain; `null` means idle. */
  let tail: Promise<void> | null = null;

  async function pushWithRetry(enabled: boolean, isTransition: boolean): Promise<void> {
    // A failed ENABLE leaves Rust closed, which is safe; a failed DISABLE
    // leaves it open, which is not. Only the unsafe direction gets retries.
    const attempts = enabled ? 1 : MAX_DISABLE_ATTEMPTS;
    // …but only a user-initiated switch-off is worth ALARMING about. The
    // bootstrap push of `false` is a baseline sync against a Rust side that
    // already starts fail-closed, so failing it changes nothing the user
    // needs to act on; toasting there would cry wolf at every launch with a
    // flaky IPC.
    const alertOnFailure = !enabled && isTransition;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (stopped || desired !== enabled) return;
      try {
        await invoke("workflow_engine_policy", { enabled });
        return;
      } catch (error) {
        if (attempt < attempts) {
          workflowWarn(
            `workflow engine policy push failed (attempt ${attempt}/${attempts}); retrying`,
            error,
          );
          await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        if (!alertOnFailure) {
          // Fail-closed: the feature is unavailable rather than unguarded.
          workflowWarn(
            "workflow engine policy sync failed; Rust remains fail-closed",
            error,
          );
          return;
        }
        // Fail-OPEN. The user switched the engine off and Rust did not hear
        // it, so this has to reach the user rather than a log file.
        workflowWarn(
          `workflow engine could not be disabled after ${attempts} attempts; ` +
            "the Rust runner may still be armed",
          error,
        );
        if (!stopped && desired === enabled) {
          toast.error(i18n.t("dialog:toast.workflowEngineDisableFailed"));
        }
        return;
      }
    }
  }

  function enqueue(enabled: boolean, isTransition: boolean): void {
    const task = () => pushWithRetry(enabled, isTransition);
    // Run IMMEDIATELY when nothing is in flight, so the bootstrap push and an
    // uncontended toggle still reach `invoke` synchronously — deferring them
    // by a microtask would widen the window in which Rust disagrees with the
    // store for no benefit. Only a contended update actually queues.
    // `.then(task, task)`: a failed push must not poison the chain for the
    // next one (`pushWithRetry` never rejects, but the queue must not depend
    // on that staying true).
    const run = tail === null ? task() : tail.then(task, task);
    tail = run;
    void run.finally(() => {
      if (tail === run) tail = null;
    });
  }

  enqueue(desired, false);

  const unsubscribe = useSettingsStore.subscribe((state) => {
    const next = state.advanced.workflowEngine ?? false;
    if (next === desired) return;
    desired = next;
    enqueue(next, true);
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}
