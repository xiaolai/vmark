/**
 * Content-server store (Phase 5).
 *
 * Tracks the local knowledge-base / Slidev content server's lifecycle for the
 * UI: starting/running status, running URL/port, the active Slidev deck preview,
 * and errors. The Rust `content_server` commands drive these transitions; the
 * KB panel + Slidev preview panel read them via selectors.
 *
 * @module stores/contentServerStore
 */

import { create } from "zustand";
import { publishDevGlobal } from "@/utils/devDebugHandle";

/** Nothing installs a runtime on demand, so there is no provisioning status. */
export type ServerStatus = "stopped" | "starting" | "running" | "error";
/** In-app KB view: the served site (iframe) or the native relationship graph. */
export type KbViewMode = "site" | "graph";

interface ContentServerState {
  status: ServerStatus;
  url: string | null;
  port: number | null;
  error: string | null;
  /** Absolute path of the deck currently previewed in the Slidev panel, if any. */
  slidevDeckPath: string | null;
  /** Whether the in-app KB inspector panel is open. */
  panelOpen: boolean;
  /**
   * URL the in-app iframe loads: a one-time `/__auth?t=<nonce>` link that sets
   * the session cookie on the loopback origin then redirects to `/` (grill M2 —
   * SameSite=Strict means the iframe must auth via navigation, not a header).
   */
  iframeUrl: string | null;
  /** Which in-app KB view is active. */
  viewMode: KbViewMode;
}

interface ContentServerActions {
  setStarting: () => void;
  setRunning: (url: string, port: number) => void;
  setError: (message: string) => void;
  setSlidevDeck: (path: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setIframeUrl: (url: string | null) => void;
  setViewMode: (mode: KbViewMode) => void;
  stop: () => void;
  reset: () => void;
}

export type ContentServerStore = ContentServerState & ContentServerActions;

const initialState: ContentServerState = {
  status: "stopped",
  url: null,
  port: null,
  error: null,
  slidevDeckPath: null,
  panelOpen: false,
  iframeUrl: null,
  viewMode: "site",
};

export const useContentServerStore = create<ContentServerStore>((set) => ({
  ...initialState,

  // The previous run's `/__auth?t=<nonce>` link dies with its child, so a new
  // start drops it here. Left in place, the KB panel kept a URL
  // naming the OLD port and a spent nonce as observable state right through
  // `setRunning`, until the fresh auth URL settled — and if that fetch failed
  // the panel would have loaded the dead link.
  setStarting: () => set({ status: "starting", error: null, iframeUrl: null }),

  setRunning: (url, port) =>
    set({ status: "running", url, port, error: null }),

  setError: (message) => set({ status: "error", error: message }),

  setSlidevDeck: (slidevDeckPath) => set({ slidevDeckPath }),

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setIframeUrl: (iframeUrl) => set({ iframeUrl }),

  setViewMode: (viewMode) => set({ viewMode }),

  stop: () =>
    set({ status: "stopped", url: null, port: null, slidevDeckPath: null, iframeUrl: null }),

  reset: () => set({ ...initialState }),
}));

/* Dev helper: expose the store so E2E (Tauri MCP) can toggle the panel (DEV-gated inside publishDevGlobal). */
publishDevGlobal("__contentServerStore", useContentServerStore);

/* Selectors — components MUST use these (no store destructuring). */
export const selectServerStatus = (s: ContentServerStore): ServerStatus => s.status;
export const selectServerUrl = (s: ContentServerStore): string | null => s.url;
export const selectSlidevDeck = (s: ContentServerStore): string | null => s.slidevDeckPath;
export const selectIsRunning = (s: ContentServerStore): boolean => s.status === "running";
export const selectError = (s: ContentServerStore): string | null => s.error;
export const selectPanelOpen = (s: ContentServerStore): boolean => s.panelOpen;
export const selectIframeUrl = (s: ContentServerStore): string | null => s.iframeUrl;
export const selectViewMode = (s: ContentServerStore): KbViewMode => s.viewMode;
