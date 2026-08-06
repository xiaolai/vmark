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

export function validateTimeout(value: unknown): number | null {
  if (value === undefined) return 12_000;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 12_000 ? value : null;
}

export function validateNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function ensureBrokerStarted(): Promise<void> {
  await browserEventBroker.start();
}

/** Activate the owning tab before an AI operation can depend on its surface. */
export async function activateBrowserTarget(target: BrowserTarget): Promise<void> {
  const currentWindow = getCurrentWindowLabel();
  if (target.windowLabel !== currentWindow) {
    await invoke("focus_window", { label: target.windowLabel });
  }
  useTabStore.getState().setActiveTab(target.windowLabel, target.tabId);
}

export async function readAiState(tabId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("browser_ai_state", { tabId });
}
