/**
 * Content-server service (Phase 5) — thin typed wrappers over the Rust
 * `content_server` Tauri commands, plus browser-open + Slidev export helpers.
 *
 * Tier: services/ may import Tauri APIs (ADR-013). UI consumes this via the
 * `useContentServer` hook; never invokes directly.
 *
 * @module services/contentServer
 */

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface ServerHandle {
  url: string;
  port: number;
}

export type SlidevExportFormat = "pdf" | "png" | "pptx";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Start (provisioning if needed) the content server for a workspace. */
export async function startContentServer(workspaceRoot: string): Promise<ServerHandle> {
  return invoke<ServerHandle>("content_server_start", { workspaceRoot });
}

/** Stop the content server for a workspace. */
export async function stopContentServer(workspaceRoot: string): Promise<void> {
  await invoke("content_server_stop", { workspaceRoot });
}

/** Query the current server handle, or null if not running. */
export async function getContentServerStatus(
  workspaceRoot: string
): Promise<ServerHandle | null> {
  return invoke<ServerHandle | null>("content_server_status", { workspaceRoot });
}

/**
 * Mint a one-time authenticated URL (`/__auth?t=<nonce>`). The Rust side mints
 * the nonce over loopback so the long-lived token never reaches JS or a URL
 * (VULN-001). Used both for the in-app iframe (grill M2) and the external
 * browser. Each call returns a fresh single-use URL.
 */
export async function getKbAuthUrl(workspaceRoot: string): Promise<string> {
  return invoke<string>("content_server_browser_url", { workspaceRoot });
}

/** Open the KB site in the user's external browser via a fresh auth URL. */
export async function openKbInBrowser(workspaceRoot: string): Promise<string> {
  const url = await getKbAuthUrl(workspaceRoot);
  await openUrl(url);
  return url;
}

/** Fetch the relationship graph JSON (Rust-proxied to avoid CORS; grill H5). */
export async function getKbGraph(workspaceRoot: string): Promise<unknown> {
  const json = await invoke<string>("content_server_graph", { workspaceRoot });
  return JSON.parse(json);
}

/** Start a Slidev preview for a deck; returns the proxied preview URL. */
export async function startSlidevPreview(workspaceRoot: string, deckPath: string): Promise<string> {
  return invoke<string>("content_server_slidev_preview", { workspaceRoot, deckPath });
}

/** Export a Slidev deck. Provisions playwright-chromium on first use (Rust side). */
export async function exportSlidev(
  workspaceRoot: string,
  deckPath: string,
  format: SlidevExportFormat,
  outputPath: string
): Promise<string> {
  try {
    return await invoke<string>("content_server_slidev_export", {
      workspaceRoot,
      deckPath,
      format,
      outputPath,
    });
  } catch (error) {
    throw new Error(`Slidev export failed: ${toMessage(error)}`);
  }
}
