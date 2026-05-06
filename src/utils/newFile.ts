/**
 * Utility for creating new untitled files.
 *
 * WI-1B.10 — accepts an optional formatId so future "New Other Format"
 * UI can land without changing this function. Today the formatId
 * defaults to "markdown" (the canonical untitled format); the field is
 * forwarded to tabStore.createTab via createTab(... , null) where
 * tabStore's deriveFormatId(null) maps to "markdown" (registry default).
 *
 * @module utils/newFile
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

/**
 * Create a new untitled tab with an empty document.
 *
 * @param windowLabel - The window label where the tab should be created.
 * @param formatId - Optional format id (defaults to "markdown"). The
 *   tabStore derives the actual formatId from the file path; passing a
 *   formatId here is internal plumbing for a future "New Other Format"
 *   UI. Currently unused by callers.
 * @returns The ID of the newly created tab.
 */
export function createUntitledTab(
  windowLabel: string,
  /* v8 ignore next 2 -- @preserve formatId param reserved for v1.x "New Other Format" UI */
   
  _formatId: string = "markdown",
): string {
  const tabId = useTabStore.getState().createTab(windowLabel, null);
  useDocumentStore.getState().initDocument(tabId, "", null);
  return tabId;
}
