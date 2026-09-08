/**
 * Content-server service (Phase 5) — thin typed wrappers over the Rust
 * `content_server` Tauri commands, plus browser-open + Slidev export helpers.
 *
 * Tier: services/ may import Tauri APIs (ADR-013). UI consumes this via the
 * `useContentServer` hook; never invokes directly.
 *
 * Implementation lives here (not in `index.ts`) so coverage tracks it —
 * `vitest.config.ts` excludes all `index.ts` barrels from coverage.
 *
 * @module services/contentServer/client
 */

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commandErrorMessage } from "@/services/commands/commandError";

export interface ServerHandle {
  url: string;
  port: number;
  /**
   * The workspace trust the running child was spawned with, which its CSP
   * enforces (WI-FL3.6). Compared with the live trust after a start: a flip
   * while starting leaves a server enforcing the old value.
   */
  trusted: boolean;
}

export type SlidevExportFormat = "pdf" | "png" | "pptx";

/**
 * What `content_server_start` would find, probed WITHOUT spawning anything
 * (WI-FL1.1). Mirrors `content_server/runtime.rs::ContentServerRuntime`;
 * absent optionals arrive as `null`. Consumers index the halves as
 * `ContentServerRuntime["node"]` rather than through named aliases.
 */
export interface ContentServerRuntime {
  /** `node` on the login-shell PATH. */
  node: "ready" | "missing";
  nodePath: string | null;
  /** The content-server `cli.js`. */
  cli: "ready" | "missing";
  /** Which candidate in Rust's `resolve_cli` order produced the CLI. */
  cliSource: "env" | "bundled" | "provisioned" | null;
  detail: string | null;
}

/**
 * Start (provisioning if needed) the content server for a workspace, spawned
 * with the workspace's trust. `trusted` only relaxes the served CSP so remote
 * `https:` images render; the Rust side restarts a running server whose trust
 * differs, so calling this again after a trust change is the reconcile step.
 */
export async function startContentServer(
  workspaceRoot: string,
  trusted: boolean,
): Promise<ServerHandle> {
  return invoke<ServerHandle>("content_server_start", { workspaceRoot, trusted });
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
 * Probe the runtime the knowledge base needs — `node` on the login-shell PATH
 * and the content-server `cli.js` — without starting a server. The panel calls
 * this on open so it can name what is missing instead of failing a start.
 */
export async function getContentServerRuntime(): Promise<ContentServerRuntime> {
  return invoke<ContentServerRuntime>("content_server_runtime");
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
    throw new Error(`Slidev export failed: ${commandErrorMessage(error)}`, {
      cause: error,
    });
  }
}
