/**
 * runtimeWiring — the window-lifetime services the document window starts once
 * (round 3): grant/policy mirrors into the Rust driver, the browser tab event and
 * lifecycle consumers, recorder wiring, coherence scanning, workspace sync, the
 * native menu mirror, the per-tab provenance sessions, the journal-recording
 * lifetimes and the per-tab state cleanup. Each `start*` returns a disposer; this composes them into ONE.
 *
 * Why here and not in the hook: the hook is the React adapter (ADR-013); which
 * services a window runs is a wiring fact that unit tests can exercise without
 * React, and that reads as a list rather than a wall of paired start/stop lines.
 *
 * @coordinates-with hooks/useCommandBootstrap — starts and stops this with the window
 * @module services/runtimeWiring
 */
import { startGrantSync } from "@/services/browser/grantSync";
import { startBrowserLeaseWiring } from "@/services/browser/browserLeaseWiring";
import { startBrowserTabEvents } from "@/services/browser/browserTabEvents";
import { startBrowserTabLifecycle } from "@/services/browser/browserTabLifecycle";
import { startRecorderWiring } from "@/services/browser/recorderWiring";
import { startCoherenceScanOnChange } from "@/services/coherence/scanOnChange";
import { startWindowWorkspaceSync } from "@/services/mcpBridge/windowWorkspaceSync";
import { startWindowTabsSync } from "@/services/mcpBridge/windowTabsSync";
import { startBrowserAiPolicySync } from "@/services/browser/browserAiPolicySync";
import { startWorkflowEnginePolicySync } from "@/services/workflow/workflowEnginePolicySync";
import { startConditionalMenuItemSync } from "@/services/menu/conditionalMenuItemSync";
import { startTabStateCleanup } from "@/services/windowClose/tabCleanup";
import { startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { startRecordingLifetimes } from "@/services/agentJournal/recordingReport";
import { appError } from "@/utils/debug";

/** Every service a document window runs for its lifetime, in start order. */
const RUNTIME_SERVICES: ReadonlyArray<() => () => void> = [
  // Mirror the user's standing browser grants into the Rust driver, the
  // authoritative gate for R4/R5/R7a. Without this the driver stays
  // default-deny — safe, but the user's approvals would never take effect.
  startGrantSync,
  // Lease event sources: native page input reclaims an AI-held tab;
  // tab close drops lease state.
  startBrowserLeaseWiring,
  // Native views stay alive while their tab exists (audit 2026-09-03 L-01): one
  // window-level consumer keeps every tab's mirror honest, and the removal bus
  // is what finally destroys a view.
  startBrowserTabEvents,
  startBrowserTabLifecycle,
  // Recorder event sources: a navigation re-arms the capture shim in
  // the new document; tab close discards the recording.
  startRecorderWiring,
  startCoherenceScanOnChange,
  startWindowWorkspaceSync,
  // A request naming a tab routes to the window holding it: each window's
  // webview holds only its own tabs.
  startWindowTabsSync,
  startBrowserAiPolicySync,
  // The Rust workflow runner starts fail-closed; without this push it refuses
  // every command even for a user who has the engine switched on.
  startWorkflowEnginePolicySync,
  // Keep every conditional native menu item — "New Browser Tab",
  // "Toggle Knowledge Base" (#1425) — in step with the setting that decides it.
  // Each ships off, and a permanently-dead menu row is worse than no row.
  startConditionalMenuItemSync,
  // One provenance session per open tab: what its editors certify between
  // journal records. Without it every save is a snapshotOnly barrier.
  startProvenanceSessions,
  // A "history not recorded" entry lives as long as its document: retired when
  // no tab holds its key and no save to it is outstanding (close, Save As).
  startRecordingLifetimes,
  // A tab that leaves the tab store takes its document and every other piece of
  // per-tab state with it. This is what makes that a consequence of removal
  // rather than a step each close, detach or rollback site has to remember.
  startTabStateCleanup,
];

/**
 * Start every runtime service; the returned disposer stops them in reverse order.
 *
 * Startup is transactional: if a service throws while starting,
 * the ones already started are stopped — in reverse order — before the error
 * propagates. Otherwise they would keep running with no disposer anywhere.
 *
 * Cleanup is BEST-EFFORT and never throws. One disposer that threw
 * used to abort every disposer after it — the services it was meant to protect
 * from a leak leaked instead — and on the rollback path its exception REPLACED
 * the startup error, so the failure that mattered never reached the caller.
 * Each failure is logged at its own site and the sweep continues.
 */
export function startRuntimeServices(): () => void {
  const stops: Array<() => void> = [];
  const stopAll = () => {
    // A COPY: `reverse()` mutates in place, so reversing `stops` itself would
    // make a second call stop them in start order.
    for (const stop of [...stops].reverse()) {
      try {
        stop();
      } catch (error) {
        appError("Runtime service disposer threw; continuing teardown:", error);
      }
    }
  };
  try {
    for (const start of RUNTIME_SERVICES) stops.push(start());
  } catch (error) {
    stopAll();
    throw error;
  }
  return stopAll;
}
