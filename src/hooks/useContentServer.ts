/**
 * useContentServer (Phase 5; grill H7) — React adapter wiring the content-server
 * service to the store. Supplies start/stop/openInBrowser bound to the current
 * workspace; the KB panel consumes these. The hook is the only place that turns
 * service calls into store transitions.
 *
 * @module hooks/useContentServer
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import {
  startContentServer,
  stopContentServer,
  openKbInBrowser,
  getKbAuthUrl,
} from "@/services/contentServer";

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface ContentServerControls {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  openInBrowser: () => Promise<void>;
}

export function useContentServer(): ContentServerControls {
  const { t } = useTranslation();
  const start = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) {
      useContentServerStore.getState().setError(t("contentServer.error.noWorkspace"));
      return;
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
      // running (the iframe can retry) — don't tear down a healthy server.
      if (!started) useContentServerStore.getState().setError(toMessage(e));
    }
  }, [t]);

  const stop = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (root) {
      try {
        await stopContentServer(root);
      } catch {
        /* best-effort; the store still reflects stopped */
      }
    }
    useContentServerStore.getState().stop();
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

  return { start, stop, openInBrowser };
}
