/**
 * useDocumentResilience — single resilience composite (T07).
 *
 * Merges six pre-T07 hooks (useHotExitCapture, useHotExitRestore,
 * useHotExitStartup, useCrashRecoveryWriter, useCrashRecoveryStartup,
 * useCrashRecoveryCleanup) behind one hook and a documented state
 * machine.
 *
 * The original hook implementations live as internal helpers under
 * `resilience/_*.ts`. This entry point composes them and (optionally)
 * runs the main-window-only startup sequence.
 *
 * Usage:
 *   - `useDocumentResilience()` — per-document-window mount (capture,
 *     restore, snapshot writer, save-time cleanup)
 *   - `useDocumentResilience({ isMainWindow: true })` — additionally
 *     runs hot-exit + crash-recovery startup once
 *
 * @module services/persistence/resilience/useDocumentResilience
 */

import { useHotExitCapture } from "./_hotExitCapture";
import { useHotExitRestore } from "./_hotExitRestore";
import { useHotExitStartup } from "./_hotExitStartup";
import { useCrashRecoveryWriter } from "./_crashRecoveryWriter";
import { useCrashRecoveryStartup } from "./_crashRecoveryStartup";
import { useCrashRecoveryCleanup } from "./_crashRecoveryCleanup";

export function useDocumentResilience(): void {
  // Per-window: capture requests + restore + periodic snapshot + save-time cleanup.
  useHotExitCapture();
  useHotExitRestore();
  useCrashRecoveryWriter();
  useCrashRecoveryCleanup();
}

/**
 * Main-window-only one-shot startup sequence.
 *
 * useHotExitStartup MUST run before useCrashRecoveryStartup so the
 * restored session wins the race against the recovery file scan.
 *
 * Mount once in the main-window-only component (MainWindowRunners
 * via `MainWindowLifecycle`). Calling from a non-main context is a
 * no-op since both inner hooks short-circuit on a `useRef(hasChecked)`
 * guard — but it pollutes coordination state, so don't.
 */
export function useResilienceStartup(): void {
  useHotExitStartup();
  useCrashRecoveryStartup();
}
