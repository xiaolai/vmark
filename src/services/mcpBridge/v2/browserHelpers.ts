import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab, type BrowserAutomationMode } from "@/stores/tabStoreTypes";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { urlForAgent } from "@/lib/browser/url";

export interface BrowserTarget {
  tabId: string;
  url: string;
  generation: number;
  automationMode: BrowserAutomationMode;
  windowLabel: string;
}

export function readTabIdArg(args: Record<string, unknown>): string | undefined | null {
  if (args.tabId === undefined) return undefined;
  if (typeof args.tabId !== "string" || args.tabId.trim() === "") return null;
  return args.tabId;
}

export function resolveBrowserTab(tabIdArg?: string): BrowserTarget | null {
  const store = useTabStore.getState();
  const found = tabIdArg
    ? store.findTabById(tabIdArg)
    : store.getActiveTab(getCurrentWindowLabel());
  if (!found || !isBrowserTab(found)) return null;
  const windowLabel = Object.entries(store.tabs).find(([, tabs]) =>
    tabs.some((tab) => tab.id === found.id),
  )?.[0];
  if (!windowLabel) return null;
  return {
    tabId: found.id,
    url: found.url,
    generation: found.generation ?? 0,
    automationMode: found.automationMode ?? "human",
    windowLabel,
  };
}

export function browserEnabled(): boolean {
  return useSettingsStore.getState().browser.enabled;
}

export function aiMode(): "ai-sandbox" | "ai-shared" {
  return useSettingsStore.getState().browser.aiSession === "shared"
    ? "ai-shared"
    : "ai-sandbox";
}

export function redactUrl(url: string): string {
  return urlForAgent(url);
}

/**
 * The longest a single handler may wait, in ms — and its default.
 *
 * Below the bridge's FIRST deadline on purpose: Rust waits 10 s for a response
 * (`mcp_bridge/server.rs`) and then treats silence as a napping webview, wakes
 * it and re-emits the request. A handler that legitimately waited 12 s tripped
 * that recovery on every slow page (audit 2026-09-03, timing). Every wait in a
 * handler shares ONE budget derived from this, so two stacked waits cannot
 * exceed it either. The sidecar advertises the same bound (`browserArgs.ts`).
 */
export const MAX_WAIT_MS = 9_000;

export function validateTimeout(value: unknown): number | null {
  if (value === undefined) return MAX_WAIT_MS;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_WAIT_MS ? value : null;
}

export function validateNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function ensureBrokerStarted(): Promise<void> {
  await browserEventBroker.start();
}

/**
 * Activate the owning tab before an AI operation can depend on its surface.
 * Returns the tab as it is AFTER activation, or null when it was closed or moved
 * while `focus_window` was awaited — the caller must not go on with a snapshot of
 * a tab that no longer exists (it would create a native view for a removed tab).
 */
export async function activateBrowserTarget(target: BrowserTarget): Promise<BrowserTarget | null> {
  const currentWindow = getCurrentWindowLabel();
  if (target.windowLabel !== currentWindow) {
    await invoke("focus_window", { label: target.windowLabel });
  }
  const fresh = resolveBrowserTab(target.tabId);
  if (!fresh) return null;
  useTabStore.getState().setActiveTab(fresh.windowLabel, fresh.tabId);
  return fresh;
}

/**
 * Bound on any script handed to `browser_eval`, in UTF-8 BYTES. Rust's
 * `browser/script_limit.rs` is the authoritative limit; this exists so a
 * near-limit payload fails HERE with a clear client-side error — and, for the
 * approval-gated ops, BEFORE it is parked in the approval queue, where an
 * oversized script the driver will always refuse could otherwise be approved
 * repeatedly. 64 KiB is far above any legitimate automation snippet.
 */
export const MAX_SCRIPT_BYTES = 64 * 1024;

/** Measure a string in UTF-8 bytes: `String.length` counts UTF-16 code units, so a
 *  CJK or emoji payload passes a `.length` check at up to ~3x the byte cap. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The refusal for a script over `MAX_SCRIPT_BYTES`, or null when it fits. */
export function scriptTooLarge(script: string, what: string): string | null {
  return utf8ByteLength(script) > MAX_SCRIPT_BYTES ? `${what} exceeds the ${MAX_SCRIPT_BYTES}-byte limit` : null;
}

export async function readAiState(tabId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("browser_ai_state", { tabId });
}
