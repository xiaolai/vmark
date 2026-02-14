/**
 * Reload Guard Hook
 *
 * Purpose: Prevents accidental page reload (Cmd+R in dev) when there are
 *   unsaved documents — uses the native beforeunload event to trigger the
 *   browser's "Leave site?" dialog.
 *
 * @coordinates-with reloadGuard.ts — pure logic for shouldBlockReload
 * @module hooks/useReloadGuard
 */

import { useEffect } from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { shouldBlockReload, getReloadWarningMessage } from "@/utils/reloadGuard";

/**
 * Hook to prevent accidental page reload when documents are dirty.
 *
 * Attaches a beforeunload event listener that:
 * - Checks if any documents have unsaved changes
 * - Shows browser's native "Leave site?" dialog if dirty
 *
 * Note: The browser shows its own generic warning message.
 * Custom messages are ignored in modern browsers for security reasons.
 */
export function useReloadGuard(): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
      // Get current dirty state from store
      const dirtyTabIds = useDocumentStore.getState().getAllDirtyDocuments();

      const result = shouldBlockReload({ dirtyTabIds });

      if (result.shouldBlock) {
        // Standard way to trigger browser's leave warning
        event.preventDefault();
        // Chrome requires returnValue to be set
        event.returnValue = "";
        // Return message for older browsers (ignored by modern ones)
        return getReloadWarningMessage(result.count);
      }

      return undefined;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
}
