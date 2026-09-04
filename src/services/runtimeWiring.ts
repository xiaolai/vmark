/**
 * runtimeWiring — the window-lifetime services the document window starts once
 * (round 3): grant/policy mirrors into the Rust driver, the browser tab event and
 * lifecycle consumers, recorder wiring, coherence scanning, workspace sync and the
 * native menu mirror. Each `start*` returns a disposer; this composes them into ONE.
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
import { startBrowserAiPolicySync } from "@/services/browser/browserAiPolicySync";
import { startWorkflowEnginePolicySync } from "@/services/workflow/workflowEnginePolicySync";
import { startBrowserMenuSync } from "@/services/browser/browserMenuSync";

/** Every service a document window runs for its lifetime, in start order. */
const RUNTIME_SERVICES: ReadonlyArray<() => () => void> = [
  // Mirror the user's standing browser grants into the Rust driver, the
  // authoritative gate for R4/R5/R7a (WI-2.1). Without this the driver stays
  // default-deny — safe, but the user's approvals would never take effect.
  startGrantSync,
  // Lease event sources (WI-NB5.1): native page input reclaims an AI-held tab;
  // tab close drops lease state.
  startBrowserLeaseWiring,
  // Native views stay alive while their tab exists (audit 2026-09-03 L-01): one
  // window-level consumer keeps every tab's mirror honest, and the removal bus
  // is what finally destroys a view.
  startBrowserTabEvents,
  startBrowserTabLifecycle,
  // Recorder event sources (WI-NB7.1): a navigation re-arms the capture shim in
  // the new document; tab close discards the recording.
  startRecorderWiring,
  startCoherenceScanOnChange,
  startWindowWorkspaceSync,
  startBrowserAiPolicySync,
  // The Rust workflow runner starts fail-closed; without this push it refuses
  // every command even for a user who has the engine switched on (WI-19).
  startWorkflowEnginePolicySync,
  // Keep the native "New Browser Tab" menu item in step with the setting (WI-S0.5).
  startBrowserMenuSync,
];

/** Start every runtime service; the returned disposer stops them in reverse order. */
export function startRuntimeServices(): () => void {
  const stops = RUNTIME_SERVICES.map((start) => start());
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
