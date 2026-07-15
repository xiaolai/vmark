import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { originForAgent } from "@/lib/browser/url";
import { isOriginGranted } from "@/lib/browser/origin/originGuard";
import {
  ensureBrowserNativeView,
  waitForBrowserNativeView,
} from "@/components/Browser/useBrowserNativeView";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import {
  aiMode,
  activateBrowserTarget,
  browserEnabled,
  ensureBrokerStarted,
  readAiState,
  readTabIdArg,
  redactUrl,
  resolveBrowserTab,
  validateNonEmptyString,
  validateTimeout,
} from "./browserHelpers";

type NavigationResult = { tabId: string; navigationId: string };

function failure(id: string, error: string, data?: unknown): Promise<void> {
  return respond({ id, success: false, error, ...(data === undefined ? {} : { data }) });
}

function requestNavigationApproval(
  id: string,
  tabId: string,
  url: string,
  generation: number,
): Promise<void> {
  useBrowserApprovalStore
    .getState()
    .requestApproval(id, url, "navigate", undefined, tabId, generation);
  return failure(id, "APPROVAL_REQUIRED", {
    needsApproval: true,
    operation: "navigate",
    url: redactUrl(url),
    tabId,
    generation,
  });
}

function discardUncreatedAiTab(tabId: string, windowLabel: string): void {
  useTabStore.getState().detachTab(windowLabel, tabId);
  void invoke("browser_destroy", { tabId }).catch(() => {});
}

function eventData(result: Awaited<ReturnType<typeof browserEventBroker.wait>>, tabId: string) {
  if (result.kind === "loaded") {
    return {
      tabId,
      url: redactUrl(result.url),
      title: result.title,
      navigationId: result.navigationId,
      generation: result.generation,
      loading: false,
    };
  }
  return { tabId, navigationId: "navigationId" in result ? result.navigationId : undefined, loading: false };
}

async function waitForNavigation(
  id: string,
  tabId: string,
  navigationId: string,
  timeoutMs: number,
): Promise<void> {
  const result = await browserEventBroker.wait(tabId, navigationId, timeoutMs);
  if (result.kind === "loaded") {
    // Persist the committed generation (and url) onto the tab record. `open`
    // waits on the broker for the initial load, whose event is consumed here
    // before BrowserSurface mounts its own nav-event listener — so without this
    // the tab keeps `generation: undefined`, resolveBrowserTab defaults it to 0,
    // and the driver rejects the first read/act as a stale command until an
    // unrelated navigation happens to sync it. The store ignores an older
    // generation, so this never regresses a tab BrowserSurface already advanced.
    useTabStore.getState().updateBrowserTab(tabId, {
      url: result.url,
      generation: result.generation,
    });
    await respond({ id, success: true, data: eventData(result, tabId) });
  } else if (result.kind === "failed") {
    await failure(id, "NAVIGATION_FAILED", {
      ...eventData(result, tabId),
      error: result.message,
    });
  } else if (result.kind === "superseded") {
    await failure(id, "NAVIGATION_SUPERSEDED", eventData(result, tabId));
  } else if (result.kind === "timeout") {
    await failure(id, "TIMEOUT", eventData(result, tabId));
  } else if (result.kind === "disabled") {
    await failure(id, "BROWSER_DISABLED", eventData(result, tabId));
  } else if (result.kind === "unmounted") {
    await failure(id, "WINDOW_UNAVAILABLE", eventData(result, tabId));
  } else {
    await failure(id, "TAB_NOT_FOUND");
  }
}

export async function handleBrowserOpen(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) return failure(id, "BROWSER_DISABLED");
    if (!validateNonEmptyString(args.url)) return failure(id, "INVALID_URL");
    const timeoutMs = validateTimeout(args.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    await ensureBrokerStarted();
    const windowLabel = getCurrentWindowLabel();
    // Optional named profile (WI-P6.1): AI-sandbox persistent store, safe charset.
    const profile =
      typeof args.profile === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(args.profile.trim())
        ? args.profile.trim()
        : undefined;
    // H1: opening a named profile needs a FRESH per-use approval — without a
    // single-use (profile, origin) grant, raise the prompt and DON'T create the tab,
    // so a guessed profile can't silently open authenticated content. The driver
    // (browser_ai_create) re-enforces this authoritatively.
    if (profile) {
      const targetUrl = String(args.url);
      const approvals = useBrowserApprovalStore;
      const grantIdx = approvals
        .getState()
        .profileOpens.findIndex((g) => g.profile === profile && isOriginGranted(targetUrl, [g.originPattern]));
      if (grantIdx === -1) {
        if (!approvals.getState().pending.some((p) => p.id === id)) {
          approvals.setState((s) => ({
            pending: [...s.pending, { id, targetUrl, operation: "session", tabId: "", generation: 0, profile }],
          }));
        }
        const origin = originForAgent(targetUrl);
        await respond({
          id,
          success: false,
          error: `approval required: open profile '${profile}' on ${origin}`,
          data: { needsApproval: true, operation: "session", action: "open-profile", profile, url: origin },
        });
        return;
      }
      approvals.setState((s) => ({ profileOpens: s.profileOpens.filter((_, i) => i !== grantIdx) }));
    }
    const tabId = useTabStore.getState().createBrowserTab(windowLabel, args.url, undefined, aiMode());
    try {
      await ensureBrowserNativeView(tabId, args.url, aiMode(), profile);
      if (profile) useBrowserSessionStore.getState().recordProfileUse(profile, Date.now());
    } catch (error) {
      if (String(error).includes("APPROVAL_REQUIRED")) {
        await requestNavigationApproval(id, tabId, args.url, 0);
        return;
      }
      discardUncreatedAiTab(tabId, windowLabel);
      await failure(id, String(error));
      return;
    }
    let state: Record<string, unknown>;
    try {
      state = await readAiState(tabId);
    } catch (error) {
      discardUncreatedAiTab(tabId, windowLabel);
      await failure(id, String(error));
      return;
    }
    const navigationId = typeof state.navigationId === "string" ? state.navigationId : undefined;
    if (!navigationId) {
      discardUncreatedAiTab(tabId, windowLabel);
      await failure(id, "WINDOW_UNAVAILABLE");
      return;
    }
    const ticket: NavigationResult = { tabId, navigationId };
    await waitForNavigation(id, ticket.tabId, ticket.navigationId, timeoutMs);
  });
}

export async function handleBrowserNavigate(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) return failure(id, "BROWSER_DISABLED");
    if (!validateNonEmptyString(args.url)) return failure(id, "INVALID_URL");
    const timeoutMs = validateTimeout(args.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) return failure(id, "INVALID_TAB");
    const target = resolveBrowserTab(tabIdArg ?? undefined);
    if (!target) return failure(id, tabIdArg === undefined ? "TAB_NOT_FOUND" : "TAB_NOT_FOUND");
    if (target.automationMode === "human") return failure(id, "TAB_NOT_AI_OWNED");
    try {
      await activateBrowserTarget(target);
      await ensureBrowserNativeView(target.tabId, target.url, target.automationMode);
      await waitForBrowserNativeView(target.tabId, timeoutMs);
    } catch (error) {
      if (String(error).includes("APPROVAL_REQUIRED")) {
        await requestNavigationApproval(id, target.tabId, target.url, target.generation);
        return;
      }
      return failure(id, "WINDOW_UNAVAILABLE");
    }
    await ensureBrokerStarted();
    let ticket: NavigationResult;
    try {
      ticket = await invoke<NavigationResult>("browser_ai_navigate", {
        tabId: target.tabId,
        url: args.url,
      });
    } catch (error) {
      if (String(error).includes("APPROVAL_REQUIRED")) {
        await requestNavigationApproval(id, target.tabId, args.url, target.generation);
        return;
      }
      await failure(id, String(error));
      return;
    }
    await waitForNavigation(id, ticket.tabId, ticket.navigationId, timeoutMs);
  });
}

export async function handleBrowserWait(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) return failure(id, "BROWSER_DISABLED");
    const timeoutMs = validateTimeout(args.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    if (args.navigationId !== undefined && !validateNonEmptyString(args.navigationId)) {
      return failure(id, "INVALID_NAVIGATION");
    }
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) return failure(id, "INVALID_TAB");
    const target = resolveBrowserTab(tabIdArg ?? undefined);
    if (!target) return failure(id, "TAB_NOT_FOUND");
    if (target.automationMode === "human") return failure(id, "TAB_NOT_AI_OWNED");
    try {
      await activateBrowserTarget(target);
      await ensureBrowserNativeView(target.tabId, target.url, target.automationMode);
      await waitForBrowserNativeView(target.tabId, timeoutMs);
    } catch (error) {
      if (String(error).includes("APPROVAL_REQUIRED")) {
        await requestNavigationApproval(id, target.tabId, target.url, target.generation);
        return;
      }
      return failure(id, "WINDOW_UNAVAILABLE");
    }
    await ensureBrokerStarted();
    const navigationId = typeof args.navigationId === "string"
      ? args.navigationId
      : browserEventBroker.latestNavigationId(target.tabId);
    if (!navigationId) {
      const state = await readAiState(target.tabId);
      await respond({ id, success: true, data: { ...state, url: redactUrl(target.url), loading: false } });
      return;
    }
    await waitForNavigation(id, target.tabId, navigationId, timeoutMs);
  });
}
