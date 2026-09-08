/**
 * Purpose: Runs the optional `actionlint` binary over the workbench's
 *   workflow text and returns its findings as `Diagnostic` rows for the
 *   DiagnosticsBanner — the behaviour `website/guide/workflow-viewer.md` and
 *   the "Use actionlint when available" setting promise. Until WI-FL3.8 the
 *   wrapper's only production caller was the MCP `workflow.validate`
 *   handler, so the setting changed nothing a user could see.
 *
 *   Runner: `lintWithActionlint` → the Rust `gha_lint` command, which spawns
 *   the binary from the login-shell PATH on the blocking pool. A process
 *   spawn per keystroke is not acceptable, so runs are debounced on the
 *   document text (ACTIONLINT_DEBOUNCE_MS) and SERIALIZED per hook: a run
 *   waits for the in-flight one to settle, and only the latest text runs
 *   when it does — a superseded run's result is discarded, and its process
 *   is never joined by a second one (audit 20260907, #290). Serializing puts
 *   the whole queue behind one call, so each is bounded by
 *   ACTIONLINT_TIMEOUT_MS (audit R2, #585). The parser's rows never wait for
 *   this hook: it starts empty and the banner re-renders when a run lands.
 *
 * Key decisions:
 *   - Rows persist while a re-run is pending (no flicker on every edit) but
 *     vanish the instant the setting goes off or the hook moves to another
 *     tab: the returned list is DERIVED from (enabled, tab, last result),
 *     never cleared by a setState inside an effect.
 *   - Unavailability is said ONCE per app session, per kind. `binary_missing`
 *     → one info toast: the setting is on by default and most machines lack
 *     the binary, so silence would make "ran clean" and "never ran" look
 *     identical, while a toast per run would be spam. `failed`, or a
 *     rejected IPC → one warning toast with actionlint's own message as the
 *     detail line (WI-UI4.4). Module-level flags, reset only by the test
 *     seam.
 *   - Translation goes through the i18n singleton rather than
 *     `useTranslation`, so the effect depends on (enabled, tab, text) alone;
 *     a `t` that changed identity per render would re-arm the debounce on
 *     every render.
 *
 * @coordinates-with src/lib/ghaWorkflow/lint/actionlint.ts — lintWithActionlint, ActionlintOutcome
 * @coordinates-with src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx — merges the rows into the banner
 * @coordinates-with src/stores/settingsStore.ts — advanced.workflowActionlint
 * @coordinates-with src/stores/documentStore.ts — the hosting tab's content
 * @coordinates-with src/services/ime/imeToast.ts — the once-per-session notices
 * @module components/Editor/WorkflowEditor/useActionlintDiagnostics
 */

import { useEffect, useRef, useState } from "react";
import i18n from "@/i18n";
import {
  lintWithActionlint,
  type ActionlintOutcome,
} from "@/lib/ghaWorkflow/lint/actionlint";
import type { Diagnostic } from "@/lib/ghaWorkflow/types";
import { imeToast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { workflowError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/** Quiet period after the last edit before actionlint is spawned. */
export const ACTIONLINT_DEBOUNCE_MS = 500;

/**
 * How long one run may take before the hook stops waiting for it.
 *
 * The runs are SERIALIZED, so a call that never settles is not one lost
 * result: every later run queues behind it and the banner keeps the rows it
 * had for the rest of the session (audit R2, #585). A spawn that hangs — a
 * binary waiting on stdin, a stalled network mount — settles nothing on its
 * own, and only the frontend half is reachable from here: this releases the
 * QUEUE, it does not kill the process, which is `gha_lint`'s to do.
 *
 * Generous on purpose: actionlint answers in milliseconds, so anything near
 * this is already pathological rather than slow.
 */
export const ACTIONLINT_TIMEOUT_MS = 15_000;

const EMPTY: readonly Diagnostic[] = Object.freeze([]);

interface LintResult {
  /** The tab the rows belong to — rows from another tab are never shown. */
  tabId: string;
  diagnostics: readonly Diagnostic[];
}

const noticed = { missing: false, failed: false };

/** Test-only: forget which unavailability notices this session has shown. */
export function __resetActionlintNoticesForTests(): void {
  noticed.missing = false;
  noticed.failed = false;
}

function noticeOnce(outcome: ActionlintOutcome): void {
  if (outcome.error !== undefined) {
    if (noticed.failed) return;
    noticed.failed = true;
    imeToast.warning(
      i18n.t("workflowEditor:diagnosticsBanner.actionlintFailed"),
      { description: outcome.error },
    );
    return;
  }
  if (!outcome.binaryAvailable && !noticed.missing) {
    noticed.missing = true;
    imeToast.info(i18n.t("workflowEditor:diagnosticsBanner.actionlintMissing"));
  }
}

/**
 * Run actionlint over `yaml` once the previous run in `chain` has settled —
 * unless the caller was superseded by then — and hand the outcome back.
 * Returns the new chain tail: one process at a time, and a waiter that was
 * superseded while waiting spawns nothing, so only the latest text runs.
 */
/** `work`, or a timed-out outcome once `ACTIONLINT_TIMEOUT_MS` has passed. */
async function withTimeout(work: Promise<ActionlintOutcome>): Promise<ActionlintOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<ActionlintOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          binaryAvailable: false,
          diagnostics: [],
          error: i18n.t("workflowEditor:diagnosticsBanner.actionlintTimedOut"),
        }),
      ACTIONLINT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function queueLint(
  chain: Promise<void>,
  yaml: string,
  isStale: () => boolean,
  onOutcome: (outcome: ActionlintOutcome) => void,
): Promise<void> {
  const run = chain.then(async () => {
    if (isStale()) return;
    let outcome: ActionlintOutcome;
    try {
      outcome = await withTimeout(lintWithActionlint(yaml));
    } catch (e: unknown) {
      // The wrapper catches its own IPC failure; this guards the wrapper
      // itself so a thrown lint can never take the banner down with it.
      outcome = { binaryAvailable: false, diagnostics: [], error: errorMessage(e) };
    }
    if (isStale()) return;
    try {
      onOutcome(outcome);
    } catch (e: unknown) {
      // DELIVERY is the caller's code — a toast surface, a state update — and
      // it is outside everything above. A throw here used to reject the tail
      // this function returns (audit round 3, #584).
      workflowError("actionlint outcome delivery failed:", e);
    }
  });
  // The stored tail must be a SETTLED-either-way promise. `chainRef.current`
  // holds it, and the next run is `chain.then(work)`: on a rejected chain that
  // callback never runs, so one failure skipped every later lint for the rest
  // of the session — and threw an unhandled rejection each time. Recovering
  // here bounds the damage to the one run that failed.
  return run.catch((e: unknown) => {
    workflowError("actionlint run failed:", e);
  });
}

/**
 * actionlint's rows for the workflow open in `tabId`, or an empty list when
 * the setting is off, there is no document, or actionlint is unavailable.
 */
export function useActionlintDiagnostics(
  tabId: string | null,
): readonly Diagnostic[] {
  const enabled = useSettingsStore((s) => s.advanced.workflowActionlint);
  const yaml = useDocumentStore((s) =>
    tabId ? (s.documents[tabId]?.content ?? null) : null,
  );
  const [result, setResult] = useState<LintResult | null>(null);
  /** The tail of this hook's run chain — what the next run waits for. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!enabled || !tabId || !yaml) return;
    let superseded = false;
    const timer = setTimeout(() => {
      chainRef.current = queueLint(chainRef.current, yaml, () => superseded, (outcome) => {
        noticeOnce(outcome);
        setResult({ tabId, diagnostics: outcome.diagnostics });
      });
    }, ACTIONLINT_DEBOUNCE_MS);
    return () => {
      superseded = true;
      clearTimeout(timer);
    };
  }, [enabled, tabId, yaml]);

  return enabled && yaml && result?.tabId === tabId
    ? result.diagnostics
    : EMPTY;
}
