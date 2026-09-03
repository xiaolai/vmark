/** Synchronize user browser posture settings with Rust's fail-closed policy. */
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { destroyBrowserNativeView } from "./browserNativeViews";
import { browserEventBroker } from "./browserEventBroker";
import { browserWarn } from "@/utils/debug";

type BrowserPolicy = {
  enabled: boolean;
  session: "sandbox" | "shared";
  allowLoopback: boolean;
};

function currentPolicy(): BrowserPolicy {
  const browser = useSettingsStore.getState().browser;
  return {
    enabled: browser.enabled,
    session: browser.aiSession,
    allowLoopback: browser.aiAllowLoopback,
  };
}

/**
 * Close every browser tab (or every AI-owned one) and drop the authority that went
 * with them. Detaching the tab fires the removal bus, whose lifecycle subscriber
 * destroys the native view; the explicit destroy here is idempotent and covers a
 * window whose bootstrap has not started that subscriber yet.
 *
 * Switching the browser OFF also revokes every standing grant (audit 2026-09-03
 * #12): "withdraws the AI automation surface" must include the authority it had
 * accumulated, or switching it back on resumes acting with no fresh prompt.
 */
function destroyBrowserViews(onlyAi = false): void {
  const store = useTabStore.getState();
  for (const [windowLabel, tabs] of Object.entries(store.tabs)) {
    for (const tab of tabs) {
      if (!isBrowserTab(tab)) continue;
      if (onlyAi && tab.automationMode === "human") continue;
      void destroyBrowserNativeView(tab.id);
      store.detachTab(windowLabel, tab.id);
    }
  }
  useBrowserApprovalStore.getState().clearEphemeral();
  if (!onlyAi) useBrowserApprovalStore.getState().revokeAll();
  browserEventBroker.cancelPending();
}

/**
 * Mount once with the document-window command bootstrap. Rust starts disabled,
 * so the initial push is required before either manual or AI native creation.
 */
export function startBrowserAiPolicySync(): () => void {
  const push = (policy: BrowserPolicy) => {
    void invoke("browser_ai_policy", policy).catch((error: unknown) => {
      browserWarn("browser policy sync failed; Rust remains fail-closed", error);
    });
  };

  const initial = currentPolicy();
  push(initial);
  if (!initial.enabled) destroyBrowserViews();

  let previous = initial;
  const unsubscribe = useSettingsStore.subscribe((state) => {
    const next: BrowserPolicy = {
      enabled: state.browser.enabled,
      session: state.browser.aiSession,
      allowLoopback: state.browser.aiAllowLoopback,
    };
    if (
      next.enabled === previous.enabled &&
      next.session === previous.session &&
      next.allowLoopback === previous.allowLoopback
    ) {
      return;
    }
    const disabled = previous.enabled && !next.enabled;
    const postureChanged = next.session !== previous.session;
    const loopbackChanged = next.allowLoopback !== previous.allowLoopback;
    previous = next;
    push(next);
    if (disabled) destroyBrowserViews();
    else if (postureChanged || loopbackChanged) destroyBrowserViews(true);
  });

  void browserEventBroker.start().catch((error: unknown) => {
    browserWarn("browser event broker failed to start", error);
  });

  return () => {
    unsubscribe();
    void browserEventBroker.stop();
  };
}
