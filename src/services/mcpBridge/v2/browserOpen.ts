/**
 * MCP v2 `vmark.browser.open` handler — create an AI-owned tab and load a URL.
 *
 * Audit 2026-09-03: one wait budget per request (timing); in shared posture an
 * `open` refused pending destination approval keeps its tab RECORD and names the
 * retry verb (`navigate {tabId}`), because the one-shot the prompt mints is bound to
 * that tabId and a fresh `open` would create a tab it cannot match (L-02); the
 * driver's AI-tab cap surfaces as its own token (X-01). Split from
 * `browserNavigation.ts` for the file-size gate.
 *
 * @coordinates-with services/mcpBridge/v2/browserNavigationShared — the shared tail
 * @coordinates-with services/browser/browserNativeViews — native view creation
 * @module services/mcpBridge/v2/browserOpen
 */
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { MAX_PENDING_APPROVALS, useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { originForAgent } from "@/lib/browser/url";
import { isOriginGranted } from "@/lib/browser/origin/originGuard";
import { ensureBrowserNativeView } from "@/services/browser/browserNativeViews";
import { needsNavigationApproval } from "./browserFailure";
import { aiMode, ensureBrokerStarted, validateNonEmptyString, validateTimeout } from "./browserHelpers";
import { browserGate } from "./browserAccess";
import { readOperationArgs } from "./readOperationArgs";
import {
  discardUncreatedAiTab,
  failure,
  failureFrom,
  finishCreation,
  requestNavigationApproval,
} from "./browserNavigationShared";

export async function handleBrowserOpen(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const wire = readOperationArgs("vmark.browser.open", args);
    if (!validateNonEmptyString(wire.url)) return failure(id, "INVALID_URL");
    const url = wire.url;
    const timeoutMs = validateTimeout(wire.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    const deadline = Date.now() + timeoutMs;
    await ensureBrokerStarted();
    const windowLabel = getCurrentWindowLabel();
    // Optional named profile (WI-P6.1): AI-sandbox persistent store, safe charset.
    // A profile that is PRESENT but malformed — including an empty/whitespace string —
    // is rejected, never silently downgraded to an unnamed tab (a different posture
    // than asked for). Only an absent profile means "no profile" (sec review WI-P6.1
    // Validation, re-verify round 2). The Rust side validates again.
    let profile: string | undefined;
    if (wire.profile != null) {
      const raw = typeof wire.profile === "string" ? wire.profile.trim() : "";
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(raw)) return failure(id, "INVALID_PROFILE");
      profile = raw;
    }
    // H1: opening a named profile needs a FRESH per-use approval — without a
    // single-use (profile, origin) grant, raise the prompt and DON'T create the tab,
    // so a guessed profile can't silently open authenticated content. The driver
    // (browser_ai_create) re-enforces this authoritatively.
    if (profile) {
      const approvals = useBrowserApprovalStore;
      const grantIdx = approvals
        .getState()
        .profileOpens.findIndex((g) => g.profile === profile && isOriginGranted(url, [g.originPattern]));
      if (grantIdx === -1) {
        // Queue the prompt — but honor the same dedup + cap as `requestApproval`, so
        // an untrusted client cannot grow `pending` without bound by flooding
        // profile-open requests (sec review WI-P6.1 regression). Over-cap requests
        // are dropped (fail-safe: no tab, no grant).
        approvals.setState((s) =>
          s.pending.some((p) => p.id === id) || s.pending.length >= MAX_PENDING_APPROVALS
            ? s
            : {
                pending: [
                  ...s.pending,
                  { id, targetUrl: url, operation: "session", tabId: "", generation: 0, profile },
                ],
              },
        );
        const origin = originForAgent(url);
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
    const tabId = useTabStore.getState().createBrowserTab(windowLabel, url, undefined, aiMode());
    try {
      await ensureBrowserNativeView(tabId, url, aiMode(), profile);
      if (profile) useBrowserSessionStore.getState().recordProfileUse(profile, Date.now());
    } catch (error) {
      if (needsNavigationApproval(error)) {
        // Shared posture: keep the tab — the prompt is about this page, and the
        // one-shot it mints is bound to this tabId. The retry is `navigate {tabId}`.
        await requestNavigationApproval(id, tabId, url, 0, "navigate");
        return;
      }
      discardUncreatedAiTab(tabId, windowLabel);
      await failureFrom(id, error);
      return;
    }
    await finishCreation(id, tabId, deadline);
  });
}

