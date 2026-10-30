/**
 * GeniePickerOverlay — app-level mount for the genie picker, carrying its occlusion
 * policy.
 *
 * Occlusion is a shell concern rather than a picker concern: it is about the native
 * browser view painting over whatever the app draws, not about genies. So the freeze
 * lives here, in the thin thing App mounts, and `GeniePicker` (whose logic lives in
 * `useGeniePickerState`, `useGeniePickerActions` and `useGeniePickerFocus`) knows
 * nothing about browser views.
 *
 * @coordinates-with hooks/useBrowserOccluder — freezes mounted browser tabs while open
 * @coordinates-with services/browser/__tests__/overlayPolicies — declares this overlay's policy
 * @module components/GeniePicker/GeniePickerOverlay
 */
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";
import { GeniePicker } from "./GeniePicker";

export function GeniePickerOverlay() {
  const isOpen = useGeniePickerStore((s) => s.isOpen);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while the picker is up.
  useBrowserOccluder(isOpen, "genie-picker");
  return <GeniePicker />;
}
