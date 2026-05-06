/**
 * Utility for creating new untitled files.
 *
 * WI-1B.10 — accepts an optional formatId. When provided AND non-
 * markdown, the new tab's formatId is overridden via setState (the
 * default tabStore.createTab path derives formatId from filePath, which
 * is null for untitled → markdown). UI for "New Other Format" lives in
 * v1.x; the plumbing is in place so a menu item can call
 * `createUntitledTab("main", "txt")` and get a non-markdown untitled
 * tab today.
 *
 * @module utils/newFile
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getFormatById } from "@/lib/formats/registry";

/**
 * Create a new untitled tab with an empty document.
 *
 * @param windowLabel - The window label where the tab should be created.
 * @param formatId - Optional format id (defaults to "markdown"). When
 *   non-markdown and registered, the tab's formatId is overridden so the
 *   correct adapter mounts.
 * @returns The ID of the newly created tab.
 */
export function createUntitledTab(
  windowLabel: string,
  formatId: string = "markdown",
): string {
  const tabId = useTabStore.getState().createTab(windowLabel, null);
  useDocumentStore.getState().initDocument(tabId, "", null);
  // Default tabStore.deriveFormatId(null) returns "markdown". Override
  // only when the caller asked for a different (registered) format.
  if (formatId !== "markdown" && getFormatById(formatId)) {
    useTabStore.setState((state) => {
      const newTabs = { ...state.tabs };
      for (const win of Object.keys(newTabs)) {
        newTabs[win] = newTabs[win].map((t) =>
          t.id === tabId ? { ...t, formatId } : t,
        );
      }
      return { tabs: newTabs };
    });
  }
  return tabId;
}
