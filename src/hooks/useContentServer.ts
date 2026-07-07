/**
 * useContentServer (Phase 5; grill H7) — React adapter wiring the content-server
 * service to the store. Supplies start/stop/openInBrowser bound to the current
 * workspace; the KB panel consumes these. The hook is the only place that turns
 * service calls into store transitions.
 *
 * It also owns the frontend half of the supervisor policy (WI-1.2, ADR-10):
 * Rust detects an unexpected child exit and emits `content-server:exited`; this
 * hook auto-restarts up to `MAX_CONTENT_SERVER_RESTARTS` times. A manual start
 * (user clicking Start/Retry) resets the budget; auto-restarts never do, so a
 * server that crashes immediately after every spawn cannot loop forever.
 *
 * @module hooks/useContentServer
 */

import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useTabStore } from "@/stores/tabStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { contentServerWarn } from "@/utils/debug";
import {
  startContentServer,
  stopContentServer,
  openKbInBrowser,
  getKbAuthUrl,
  startSlidevPreview,
  exportSlidev,
  type SlidevExportFormat,
} from "@/services/contentServer";

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Max consecutive auto-restarts after a crash before giving up (WI-1.2). */
export const MAX_CONTENT_SERVER_RESTARTS = 3;

/** Window during which a crash signal is treated as part of a user stop (ms).
 *  Bounds the stop-intent guard so it can't get stuck and suppress later crashes. */
const STOP_INTENT_GUARD_MS = 3000;

/** Whether the supervisor should auto-restart given prior attempts. Pure. */
export function shouldAutoRestart(
  attempts: number,
  max = MAX_CONTENT_SERVER_RESTARTS,
): boolean {
  return attempts < max;
}

interface ExitPayload {
  workspaceRoot: string;
  code: number | null;
}

export interface ContentServerControls {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  openInBrowser: () => Promise<void>;
  /** Open a Slidev preview of the active deck in the external browser. */
  previewSlides: () => Promise<void>;
  /** Export the active deck to PDF (prompts for the output path). */
  exportSlides: () => Promise<void>;
}

/** Absolute path of the active tab's file, or null (untitled / no tab). */
function activeDeckPath(): string | null {
  const tabId = getActiveTabId(getCurrentWindowLabel());
  if (!tabId) return null;
  return useTabStore.getState().findTabById(tabId)?.filePath ?? null;
}

/** Derive the Slidev export format from the chosen output extension (WI-7.2). */
export function slidevFormatFromPath(outputPath: string): SlidevExportFormat {
  const ext = outputPath.slice(outputPath.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "png";
  if (ext === "pptx") return "pptx";
  return "pdf";
}

export function useContentServer(): ContentServerControls {
  const { t } = useTranslation();
  const restartAttempts = useRef(0);
  // Set when the user stops the server, so a crash signal that races the stop
  // (a genuine exit at the moment of stopping) does not trigger a restart.
  const intentionalStopRef = useRef(false);

  // Core start path, shared by the manual control and the auto-restart monitor.
  // `resetBudget` distinguishes a user-initiated start (fresh restart budget)
  // from a supervisor restart (consumes the budget).
  const startServer = useCallback(
    async (resetBudget: boolean) => {
      const root = useWorkspaceStore.getState().rootPath;
      if (!root) {
        useContentServerStore.getState().setError(t("contentServer.error.noWorkspace"));
        return;
      }
      if (resetBudget) {
        restartAttempts.current = 0;
        intentionalStopRef.current = false; // a fresh manual start re-arms supervision
      }
      useContentServerStore.getState().setStarting();
      let started = false;
      try {
        const handle = await startContentServer(root);
        useContentServerStore.getState().setRunning(handle.url, handle.port);
        started = true;
        // grill M2 — the in-app iframe authenticates via a one-time nonce URL
        // (SameSite=Strict blocks header/cookie auth on a cross-origin frame).
        const authUrl = await getKbAuthUrl(root);
        useContentServerStore.getState().setIframeUrl(authUrl);
      } catch (e) {
        // Codex audit: if the server started but only the auth URL failed, stay
        // running (the iframe can retry) — but clear any stale nonce URL so the
        // panel doesn't load a dead `/__auth` link.
        if (started) useContentServerStore.getState().setIframeUrl(null);
        else useContentServerStore.getState().setError(toMessage(e));
      }
    },
    [t],
  );

  const start = useCallback(() => startServer(true), [startServer]);

  const stop = useCallback(async () => {
    intentionalStopRef.current = true; // suppress a restart if a crash signal races
    const root = useWorkspaceStore.getState().rootPath;
    if (root) {
      try {
        await stopContentServer(root);
      } catch {
        /* best-effort; the store still reflects stopped */
      }
    }
    useContentServerStore.getState().stop();
    // Bound the guard: it only needs to cover a crash signal racing this stop.
    // Clearing it shortly after ensures a later genuine crash (e.g. if the stop
    // didn't actually take) still triggers the restart policy.
    setTimeout(() => {
      intentionalStopRef.current = false;
    }, STOP_INTENT_GUARD_MS);
  }, []);

  const openInBrowser = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return;
    try {
      await openKbInBrowser(root);
    } catch (e) {
      useContentServerStore.getState().setError(toMessage(e));
    }
  }, []);

  // Slidev preview opens the deck in the user's browser via the proxied dev
  // server. Slidev watches the on-disk deck, so saved editor edits hot-reload
  // the preview (WI-6.3 — "editing reflects" on save).
  const previewSlides = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    const deck = activeDeckPath();
    if (!root || !deck) {
      useContentServerStore.getState().setError(t("contentServer.slidev.noDeck"));
      return;
    }
    try {
      const url = await startSlidevPreview(root, deck);
      useContentServerStore.getState().setSlidevDeck(deck);
      await openUrl(url);
    } catch (e) {
      useContentServerStore.getState().setError(toMessage(e));
    }
  }, [t]);

  const exportSlides = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    const deck = activeDeckPath();
    if (!root || !deck) {
      useContentServerStore.getState().setError(t("contentServer.slidev.noDeck"));
      return;
    }
    const output = await save({
      defaultPath: deck.replace(/\.[^.]+$/, ".pdf"),
      filters: [
        { name: "PDF", extensions: ["pdf"] },
        { name: "PNG", extensions: ["png"] },
        { name: "PowerPoint", extensions: ["pptx"] },
      ],
    });
    if (!output) return; // user cancelled the save dialog
    try {
      await exportSlidev(root, deck, slidevFormatFromPath(output), output);
    } catch (e) {
      useContentServerStore.getState().setError(toMessage(e));
    }
  }, [t]);

  // Supervisor: react to Rust's crash signal with a bounded restart (WI-1.2).
  // startServer is referenced via a ref so the listener never goes stale and
  // does not need to re-subscribe on every render.
  const startServerRef = useRef(startServer);
  // Synced after commit (read only from the async crash listener below). #1063
  useEffect(() => {
    startServerRef.current = startServer;
  });
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<ExitPayload>("content-server:exited", (event) => {
      const root = useWorkspaceStore.getState().rootPath;
      if (!root || event.payload.workspaceRoot !== root) return;
      useContentServerStore.getState().stop();
      // A crash signal that races a user-initiated stop must not restart.
      if (intentionalStopRef.current) {
        intentionalStopRef.current = false;
        return;
      }
      if (shouldAutoRestart(restartAttempts.current)) {
        restartAttempts.current += 1;
        void startServerRef.current(false);
      } else {
        useContentServerStore.getState().setError(t("contentServer.error.crashed"));
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => {
        // Listener setup failed → supervision is disabled; surface it loudly
        // rather than letting it become a silent unhandled rejection.
        contentServerWarn("exit-listener setup failed", e);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [t]);

  return { start, stop, openInBrowser, previewSlides, exportSlides };
}
