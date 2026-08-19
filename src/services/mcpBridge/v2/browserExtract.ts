/**
 * MCP v2 `vmark.browser.extract` handler (WI-NB4.1) — reader-mode extraction.
 *
 * Purpose: give the model the page as clean Markdown — title, byline, article
 * prose — instead of an accessibility snapshot, for pages it wants to READ
 * rather than operate. One read-class eval captures the page HTML (capped, with
 * an honest `truncated` flag); the extraction itself runs HERE in the VMark
 * webview: `readerForUrl` dispatches through the site-plugin registry
 * (origin-secure), a site reader refines, and the generic density-heuristic
 * reader is the fallback. The page only ever exports bytes.
 *
 * Read-class: same authorization as `read`/`query` (grant-free on AI-sandbox
 * tabs; a human tab needs an attachment). Everything returned is page-derived
 * and untrusted.
 *
 * @coordinates-with lib/browser/agent/extractScript.ts — the capture script
 * @coordinates-with lib/sites/registry.ts — readerForUrl dispatch
 * @coordinates-with lib/sites/builtins.ts — lazily registers built-in sites
 * @module services/mcpBridge/v2/browserExtract
 */

import { invoke } from "@tauri-apps/api/core";
import { wrapHandler } from "./wrapHandler";
import { buildExtractHtmlScript } from "@/lib/browser/agent/extractScript";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass, parseEvalResult } from "./browserReadClass";

// Lazy-loaded: the reader-mode extractor pulls in the site registry, the
// Readability-style reader and the site plugins — only needed when the AI calls
// `extract`, so kept out of the eager app bundle every user loads.
const sitesRegistry = () => import("@/lib/sites/registry");
const sitesBuiltins = () => import("@/lib/sites/builtins");

function isCapture(v: unknown): v is { html: string; truncated: boolean } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).html === "string" &&
    typeof (v as Record<string, unknown>).truncated === "boolean"
  );
}

/** `vmark.browser.extract` — the current page as reader-mode Markdown. */
export async function handleBrowserExtract(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const [{ ensureBuiltinSitesRegistered }, { readerForUrl }] = await Promise.all([
      sitesBuiltins(),
      sitesRegistry(),
    ]);
    ensureBuiltinSitesRegistered();
    await runReadClass(id, args, {
      invoke: async (tab) => {
        const raw = await invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildExtractHtmlScript(),
          operation: "read",
          generation: tab.generation,
        });
        const capture = parseEvalResult(raw);
        if (!isCapture(capture)) {
          throw new Error("extract capture returned an unexpected shape");
        }
        const reader = readerForUrl(tab.url);
        if (reader === null) {
          throw new Error("this page cannot be read (unsupported URL)");
        }
        const result = reader.read(capture.html, tab.url);
        return {
          title: result.title,
          byline: result.byline,
          markdown: result.markdown,
          textLength: result.textLength,
          truncated: capture.truncated,
        };
      },
      data: (tab, result) => ({ ...result, url: urlForAgent(tab.url) }),
    });
  });
}
