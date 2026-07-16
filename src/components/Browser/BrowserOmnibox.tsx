/**
 * BrowserOmnibox — the browser's nav chrome, rendered in BrowserChrome
 * (WI-S1.3 / ADR-4).
 *
 * Purpose: back / forward / reload-or-stop controls plus the address bar (an
 * *omnibox* — a URL or a search query). It is the relocation of the chrome that
 * used to sit at the top of `BrowserSurface`; the surface now owns only the native
 * viewport + full-cover overlays. Reads the active browser tab's transient UI state
 * (`urlInput`, `loading`) from `browserUiStore` and drives navigation through the
 * stateless `browserNavigation` service — no `invoke` here.
 *
 * BrowserChrome mounts this only while the active tab is a browser. It sits
 * above the browser rect, so it never overlaps the native view — no occlusion
 * freeze is needed (ADR-1). No autocomplete dropdown in v1 (a dropdown would
 * overlap the rect and needs snapshot-freeze — SPIKE-S0.2).
 *
 * @coordinates-with stores/browserUiStore — urlInput/loading for the active browser tab
 * @coordinates-with services/browser/browserNavigation — submit/back/forward/reload/stop
 * @coordinates-with components/Browser/BrowserChrome — mounts this for a browser tab
 * @module components/Browser/BrowserOmnibox
 */
import { useTranslation } from "react-i18next";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBookmarkStore } from "@/stores/bookmarkStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import {
  submitOmnibox,
  reloadBrowser,
  backBrowser,
  forwardBrowser,
  stopBrowser,
} from "@/services/browser/browserNavigation";
import "./browser-omnibox.css";

export function BrowserOmnibox({ tabId }: { tabId: string }): React.ReactElement {
  const { t } = useTranslation("common");
  const urlInput = useBrowserUiStore((s) => s.entries[tabId]?.urlInput ?? "");
  const loading = useBrowserUiStore((s) => s.entries[tabId]?.loading ?? false);
  // Mirrored from the webview's own back/forward list (WI-S1.6) — a fresh tab has
  // no history, so these controls must be disabled rather than silently do nothing.
  const canGoBack = useBrowserUiStore((s) => s.entries[tabId]?.canGoBack ?? false);
  const canGoForward = useBrowserUiStore((s) => s.entries[tabId]?.canGoForward ?? false);
  // Bookmarking works off the COMMITTED url — the page the webview actually has — not the
  // address-bar text, which may be a half-typed url the user has not gone to yet.
  const committedUrl = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.url : "";
  });
  const committedTitle = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.title : "";
  });
  const bookmarked = useBookmarkStore((s) => s.has(committedUrl));

  return (
    <div className="browser-omnibox">
      <button
        type="button"
        className="browser-omnibox-btn"
        onClick={() => backBrowser(tabId)}
        disabled={!canGoBack}
        aria-label={t("browser.back")}
        title={t("browser.back")}
      >
        ‹
      </button>
      <button
        type="button"
        className="browser-omnibox-btn"
        onClick={() => forwardBrowser(tabId)}
        disabled={!canGoForward}
        aria-label={t("browser.forward")}
        title={t("browser.forward")}
      >
        ›
      </button>
      {loading ? (
        <button
          type="button"
          className="browser-omnibox-btn"
          onClick={() => stopBrowser(tabId)}
          aria-label={t("browser.stop")}
          title={t("browser.stop")}
        >
          ✕
        </button>
      ) : (
        <button
          type="button"
          className="browser-omnibox-btn"
          onClick={() => reloadBrowser(tabId)}
          aria-label={t("browser.reload")}
          title={t("browser.reload")}
        >
          ⟳
        </button>
      )}
      <form
        className="browser-omnibox-form"
        onSubmit={(e) => {
          e.preventDefault();
          submitOmnibox(tabId, urlInput);
        }}
      >
        <input
          className="browser-omnibox-input"
          type="text"
          value={urlInput}
          onChange={(e) => useBrowserUiStore.getState().setUrlInput(tabId, e.target.value)}
          aria-label={t("browser.addressBar")}
          spellCheck={false}
          autoComplete="off"
        />
      </form>
      <button
        type="button"
        className={`browser-omnibox-btn${bookmarked ? " browser-omnibox-btn--on" : ""}`}
        onClick={() => {
          const store = useBookmarkStore.getState();
          if (bookmarked) store.remove(committedUrl);
          else store.add(committedUrl, committedTitle || committedUrl);
        }}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? t("browser.bookmarks.remove") : t("browser.bookmarks.add")}
        title={bookmarked ? t("browser.bookmarks.remove") : t("browser.bookmarks.add")}
      >
        {bookmarked ? "★" : "☆"}
      </button>
      {loading && (
        <span className="browser-omnibox-loading" role="status" aria-label={t("browser.loading")} />
      )}
    </div>
  );
}
