/**
 * useWindowLifecycle — per-window window-chrome + resilience composite (T03).
 *
 * Bundles the window-level concerns: close handler, title sync, file
 * watcher, hot-exit capture/restore, crash-recovery writer/cleanup,
 * MCP bridge. After T07 lands, the four crash/hot-exit hooks merge
 * into `useDocumentResilience` and this composite stays as the single
 * window-lifecycle entry point.
 *
 * Order contract (preserved from pre-T03 DocumentWindowHooks):
 *   useWindowClose → useWindowTitle → useWindowFileWatcher
 *   → useHotExitCapture → useHotExitRestore
 *   → useCrashRecoveryWriter → useCrashRecoveryCleanup
 *   → useMcpBridge
 *
 * Mount conditionally — same constraint as `useDocumentLifecycle`:
 * call from a child component that mounts only when `isDocumentWindow`
 * is true.
 *
 * @module hooks/lifecycle/useWindowLifecycle
 */

import { useWindowClose } from "@/hooks/useWindowClose";
import { useWindowTitle } from "@/hooks/useWindowTitle";
import { useWindowFileWatcher } from "@/hooks/useWindowFileWatcher";
import { useDocumentResilience } from "@/services/persistence/resilience";
import { useMcpBridge } from "@/hooks/useMcpBridge";

export function useWindowLifecycle(): void {
  useWindowClose();
  useWindowTitle();
  useWindowFileWatcher();
  useDocumentResilience(); // T07: capture + restore + snapshot writer + cleanup
  useMcpBridge();
}
