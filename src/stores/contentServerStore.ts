/**
 * Content-server store (Phase 5).
 *
 * Tracks the local knowledge-base / Slidev content server's lifecycle for the
 * UI: provisioning progress, running URL/port, the active Slidev deck preview,
 * and errors. The Rust `content_server` commands drive these transitions; the
 * KB panel + Slidev preview panel read them via selectors.
 *
 * @module stores/contentServerStore
 */

import { create } from "zustand";

/** Mirrors the Rust `ProvisionState` discriminant (see content_server/provision.rs). */
type ProvisionPhase =
  | "missing"
  | "downloading"
  | "verifying"
  | "extracting"
  | "ready"
  | "failed";

export interface ProvisionProgress {
  phase: ProvisionPhase;
  received?: number;
  total?: number;
  version?: string;
  reason?: string;
}

export type ServerStatus = "stopped" | "provisioning" | "starting" | "running" | "error";
/** In-app KB view: the served site (iframe) or the native relationship graph. */
export type KbViewMode = "site" | "graph";

interface ContentServerState {
  status: ServerStatus;
  url: string | null;
  port: number | null;
  provision: ProvisionProgress | null;
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
  setProvision: (progress: ProvisionProgress) => void;
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
  provision: null,
  error: null,
  slidevDeckPath: null,
  panelOpen: false,
  iframeUrl: null,
  viewMode: "site",
};

export const useContentServerStore = create<ContentServerStore>((set) => ({
  ...initialState,

  setProvision: (progress) =>
    set({
      status: progress.phase === "failed" ? "error" : "provisioning",
      provision: progress,
      error: progress.phase === "failed" ? (progress.reason ?? "provisioning failed") : null,
    }),

  setStarting: () => set({ status: "starting", error: null }),

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

/* Dev helper: expose the store so E2E (Tauri MCP) can toggle the panel. */
/* v8 ignore next 3 */
if (import.meta.env.DEV) {
  (window as unknown as { __contentServerStore: typeof useContentServerStore }).__contentServerStore =
    useContentServerStore;
}

/* Selectors — components MUST use these (no store destructuring). */
export const selectServerStatus = (s: ContentServerStore): ServerStatus => s.status;
export const selectServerUrl = (s: ContentServerStore): string | null => s.url;
export const selectProvision = (s: ContentServerStore): ProvisionProgress | null => s.provision;
export const selectSlidevDeck = (s: ContentServerStore): string | null => s.slidevDeckPath;
export const selectIsRunning = (s: ContentServerStore): boolean => s.status === "running";
export const selectError = (s: ContentServerStore): string | null => s.error;
export const selectPanelOpen = (s: ContentServerStore): boolean => s.panelOpen;
export const selectIframeUrl = (s: ContentServerStore): string | null => s.iframeUrl;
export const selectViewMode = (s: ContentServerStore): KbViewMode => s.viewMode;
