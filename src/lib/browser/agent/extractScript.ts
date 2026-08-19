/**
 * Injected extract script (WI-NB4.1) — capture the page's HTML for reader-mode
 * extraction.
 *
 * Purpose: one isolated-world round trip returning `{html, truncated}` —
 * `document.documentElement.outerHTML`, capped at 2,000,000 UTF-16 code units
 * so a pathological page cannot push megabytes through the eval bridge. The
 * reading itself (`readPage` / a site reader) runs in the VMark webview, never
 * in the page: the page only ever exports bytes.
 *
 * @coordinates-with services/mcpBridge/v2/browserExtract.ts — the consumer
 * @module lib/browser/agent/extractScript
 */

/** Cap in UTF-16 code units (the unit `String.length` measures in-page). */
export const EXTRACT_HTML_CAP = 2_000_000;

/** Script: `{html, truncated}` for the current document. Never throws. */
export function buildExtractHtmlScript(): string {
  return (
    `var h='';try{h=document.documentElement?document.documentElement.outerHTML:'';}catch(e){h='';}` +
    `var t=h.length>${EXTRACT_HTML_CAP};` +
    `return JSON.stringify({html:t?h.slice(0,${EXTRACT_HTML_CAP}):h,truncated:t});`
  );
}
