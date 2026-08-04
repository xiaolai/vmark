/**
 * WorkflowEngineSlot — the one place the workflow ENGINE reaches the editor UI.
 *
 * Purpose: mount the Run/Cancel side panel only while
 * `advanced.workflowEngine` is on. Split out of `markdownSurface.tsx` by WI-19
 * so the gate is a component with a test rather than an inline `&&` inside a
 * surface that needs Tiptap to render — "the affordance is hidden" was until
 * now the ONLY thing stopping the engine, because the Rust commands ignored
 * the flag entirely (`workflow::guards` closes that half).
 *
 * The viewer flag deliberately does NOT appear here: the GitHub Actions
 * surface is the yaml adapter's `gha-workflow` schema renderer, which ships
 * always-on and is gated by neither flag.
 *
 * @coordinates-with lib/formats/adapters/markdownSurface.tsx — the sole mount
 * @coordinates-with services/featureFlags/workflowFeatureFlag.ts — the flags
 * @module components/Editor/WorkflowPanel/WorkflowEngineSlot
 */
import { lazy, Suspense } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const WorkflowSidePanel = lazy(() =>
  import("./WorkflowSidePanel").then((m) => ({
    default: m.WorkflowSidePanel,
  })),
);

export function WorkflowEngineSlot() {
  const engineEnabled = useSettingsStore((s) => s.advanced.workflowEngine);
  if (!engineEnabled) return null;
  return (
    <Suspense fallback={null}>
      <WorkflowSidePanel />
    </Suspense>
  );
}
