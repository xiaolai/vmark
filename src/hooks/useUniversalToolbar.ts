/**
 * useUniversalToolbar - Ctrl+E toggle hook
 *
 * Listens for Ctrl+E keyboard shortcut to toggle the universal toolbar.
 * Works with both WYSIWYG and Source modes.
 *
 * @module hooks/useUniversalToolbar
 */
import { useEffect, useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";

/**
 * Hook to handle Ctrl+E universal toolbar toggle.
 *
 * Attaches a global keydown listener for Ctrl+E (Cmd+E on Mac is already
 * mapped to Ctrl+E by the app).
 *
 * @example
 * function App() {
 *   useUniversalToolbar();
 *   return <Editor />;
 * }
 */
export function useUniversalToolbar(): void {
  const toggleToolbar = useCallback(() => {
    useUIStore.getState().toggleUniversalToolbar();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+E toggles toolbar (Cmd+E is already mapped to Ctrl+E by the app)
      if (e.ctrlKey && e.key.toLowerCase() === "e" && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleToolbar();
      }
    };

    // Use capture phase to intercept before editors
    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [toggleToolbar]);
}
