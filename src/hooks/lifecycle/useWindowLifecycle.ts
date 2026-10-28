/**
 * useWindowLifecycle — per-window window-chrome + resilience composite (T03).
 *
 * Bundles the window-level concerns: close handler, title sync, file
 * watcher, document resilience (hot-exit capture/restore plus the
 * crash-recovery writer and cleanup, composed by `useDocumentResilience`),
 * the MCP bridge and its connection reads, and the live-docs responder.
 *
 * Order contract (the calls below, in this order):
 *   useWindowClose → useWindowTitle → useWindowFileWatcher
 *   → useDocumentResilience → useMcpBridge → useMcpConnectionReads
 *   → useLiveDocsResponder
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
import { useDocumentResilience } from "@/hooks/resilience";
import { useMcpBridge } from "@/hooks/useMcpBridge";
import { useMcpConnectionReads } from "@/hooks/useMcpConnectionReads";
import { useLiveDocsResponder } from "@/hooks/useLiveDocsResponder";

export function useWindowLifecycle(): void {
  useWindowClose();
  useWindowTitle();
  useWindowFileWatcher();
  useDocumentResilience(); // T07: capture + restore + snapshot writer + cleanup
  useMcpBridge();
  useMcpConnectionReads(); // drop a closed MCP client's tracked reads
  useLiveDocsResponder(); // answer other windows' cleanup queries
}
