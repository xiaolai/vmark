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
import { mintProfileOpenConfirmed } from "@/services/browser/grantSync";
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
    // The posture is read ONCE: it is awaited across below, and a setting change
    // mid-flight must not let a profile slip into a shared creation.
    const mode = aiMode();
    if (profile) {
      // Rust applies a named profile to SANDBOX tabs only and silently ignores it
      // otherwise; accepting it here in shared posture reported a profile that was
      // never in effect.
      if (mode !== "ai-sandbox") {
        return failure(
          id,
          "PROFILE_REQUIRES_SANDBOX: a named profile applies to sandbox tabs only — the AI session posture is 'shared'",
          { token: "PROFILE_REQUIRES_SANDBOX" },
        );
      }
      const approvals = useBrowserApprovalStore;
      const grant = approvals
        .getState()
        .profileOpens.find((g) => g.profile === profile && isOriginGranted(url, [g.originPattern]));
      if (!grant) {
        // Queue the prompt — honoring the same dedup + cap as `requestApproval`, so
        // an untrusted client cannot grow `pending` without bound by flooding
        // profile-open requests (sec review WI-P6.1 regression). A needsApproval
        // envelope is sent only when a prompt actually exists: over the cap the
        // request is refused as such, never described as "awaiting approval".
        const pending = approvals.getState().pending;
        const existing = pending.find((p) => p.id === id);
        if (existing && (existing.profile !== profile || existing.targetUrl !== url || existing.operation !== "session")) {
          // The same request id with a different request: not "your prompt is
          // already up" but a client bug (or a probe) — refuse, never confuse.
          return failure(id, "a different approval is already pending under this request id");
        }
        if (!existing) {
          if (pending.length >= MAX_PENDING_APPROVALS) {
            return failure(id, "approval queue is full — resolve or deny pending approvals, then retry");
          }
          approvals.setState((s) => ({
            pending: [...s.pending, { id, targetUrl: url, operation: "session", tabId: "", generation: 0, profile }],
          }));
        }
        const origin = originForAgent(url);
        await respond({
          id,
          success: false,
          error: `approval required: open profile '${profile}' on ${origin}`,
          data: { needsApproval: true, operation: "session", action: "open-profile", profile, url: origin },
        });
        return;
      }
      // The driver is the authority: wait until it holds the grant before spending
      // the mirror's copy and creating the tab, or `browser_ai_create` can race the
      // mint, fail PROFILE_NOT_APPROVED and lose the user's approval.
      if (!(await mintProfileOpenConfirmed(grant))) {
        return failure(id, "PROFILE_NOT_APPROVED: the driver refused the profile authorization — retry to be prompted again", {
          token: "PROFILE_NOT_APPROVED",
        });
      }
      approvals.setState((s) => ({ profileOpens: s.profileOpens.filter((g) => g !== grant) }));
    }
    const tabId = useTabStore.getState().createBrowserTab(windowLabel, url, undefined, mode);
    try {
      await ensureBrowserNativeView(tabId, url, mode, profile);
      if (profile) useBrowserSessionStore.getState().recordProfileUse(profile, Date.now());
    } catch (error) {
      if (needsNavigationApproval(error)) {
        // Shared posture: keep the tab — the prompt is about this page, and the
        // one-shot it mints is bound to this tabId. The retry is `navigate {tabId}`.
        // Unless no prompt could be queued: then nothing can ever authorize the
        // provisional tab, and keeping it leaks a tab and a registry slot.
        if (!(await requestNavigationApproval(id, tabId, url, 0, "navigate"))) {
          discardUncreatedAiTab(tabId, windowLabel);
        }
        return;
      }
      discardUncreatedAiTab(tabId, windowLabel);
      await failureFrom(id, error);
      return;
    }
    await finishCreation(id, tabId, deadline);
  });
}

