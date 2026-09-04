/**
 * browserOpenFlow — the stages of `vmark.browser.open` (round 3, #54): profile
 * parsing, profile authorization, and the tab-creation transaction. Split out of
 * `browserOpen.ts` so each stage is a function with one job and its own tests; the
 * handler validates the request, reads the posture ONCE, and runs the stages.
 *
 * Profile authorization (WI-P6.1 H1): opening a NAMED profile needs a fresh per-use
 * approval — without a single-use (profile, origin) grant the prompt is raised and
 * NO tab is created, so a guessed profile can never silently open authenticated
 * content. The prompt honours the same dedup and cap as `requestApproval`, so an
 * untrusted client cannot grow `pending` without bound by flooding profile-open
 * requests; the same request id under a DIFFERENT request is a client bug (or a
 * probe) and is refused rather than reported as "your prompt is already up"; and
 * `needsApproval` is answered only when a prompt actually exists. The driver is the
 * authority (`browser_ai_create` re-enforces it), so the mirror's grant is spent only
 * once the driver confirms it holds the mint — a fast create used to race the mint,
 * fail PROFILE_NOT_APPROVED and lose the user's approval.
 *
 * The creation transaction: the tab record, then the native view, then the creation
 * ticket. In shared posture an `open` refused pending destination approval KEEPS
 * the record and names the retry verb (`navigate {tabId}`), because the one-shot
 * the prompt mints is bound to that tabId and a fresh `open` would create a tab it
 * cannot match (audit L-02) — unless no prompt could be queued, when nothing can
 * ever authorize the provisional tab and keeping it leaks a tab and a registry
 * slot. Any other creation failure discards the record and reports the driver's
 * typed refusal.
 *
 * @coordinates-with services/mcpBridge/v2/browserOpen.ts — the handler around these
 * @coordinates-with services/mcpBridge/v2/browserNavigationShared.ts — the shared tail
 * @coordinates-with services/browser/browserNativeViews.ts — native view creation
 * @coordinates-with services/browser/grantSync.ts — mintProfileOpenConfirmed
 * @module services/mcpBridge/v2/browserOpenFlow
 */
import { respond } from "@/services/mcpBridge/utils";
import { useTabStore } from "@/stores/tabStore";
import { MAX_PENDING_APPROVALS, useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { originForAgent } from "@/lib/browser/url";
import { isOriginGranted } from "@/lib/browser/origin/originGuard";
import { ensureBrowserNativeView } from "@/services/browser/browserNativeViews";
import { mintProfileOpenConfirmed } from "@/services/browser/grantSync";
import { needsNavigationApproval } from "./browserFailure";
import type { aiMode } from "./browserHelpers";
import { QUEUE_FULL_MESSAGE } from "./browserApprovalFlow";
import {
  discardUncreatedAiTab,
  failure,
  failureFrom,
  finishCreation,
  requestNavigationApproval,
} from "./browserNavigationShared";

/** The AI session posture an `open` runs under, read once per request. */
export type AiMode = ReturnType<typeof aiMode>;

/** Safe charset, 1–64 chars; the Rust side validates again. */
const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;

export type ProfileParse = { ok: true; profile: string | undefined } | { ok: false };

/**
 * An optional named profile (WI-P6.1): an AI-sandbox persistent store. A profile
 * that is PRESENT but malformed — including an empty/whitespace string — is
 * rejected, never silently downgraded to an unnamed tab (a different posture than
 * asked for). Only an absent profile means "no profile" (sec review WI-P6.1
 * Validation, re-verify round 2).
 */
export function readProfile(raw: unknown): ProfileParse {
  if (raw == null) return { ok: true, profile: undefined };
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return PROFILE_RE.test(trimmed) ? { ok: true, profile: trimmed } : { ok: false };
}

/**
 * Authorize opening `url` under the named `profile`. True means the single-use
 * grant is spent and the tab may be created; false means the request has been
 * answered — the prompt, or a refusal.
 */
export async function authorizeProfileOpen(id: string, url: string, profile: string, mode: AiMode): Promise<boolean> {
  // Rust applies a named profile to SANDBOX tabs only and silently ignores it
  // otherwise; accepting it here in shared posture reported a profile that was
  // never in effect.
  if (mode !== "ai-sandbox") {
    await failure(
      id,
      "PROFILE_REQUIRES_SANDBOX: a named profile applies to sandbox tabs only — the AI session posture is 'shared'",
      { token: "PROFILE_REQUIRES_SANDBOX" },
    );
    return false;
  }
  const approvals = useBrowserApprovalStore;
  const grant = approvals
    .getState()
    .profileOpens.find((g) => g.profile === profile && isOriginGranted(url, [g.originPattern]));
  if (!grant) {
    const pending = approvals.getState().pending;
    const existing = pending.find((p) => p.id === id);
    if (existing && (existing.profile !== profile || existing.targetUrl !== url || existing.operation !== "session")) {
      await failure(id, "a different approval is already pending under this request id");
      return false;
    }
    if (!existing) {
      if (pending.length >= MAX_PENDING_APPROVALS) {
        await failure(id, QUEUE_FULL_MESSAGE);
        return false;
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
    return false;
  }
  if (!(await mintProfileOpenConfirmed(grant))) {
    await failure(id, "PROFILE_NOT_APPROVED: the driver refused the profile authorization — retry to be prompted again", {
      token: "PROFILE_NOT_APPROVED",
    });
    return false;
  }
  approvals.setState((s) => ({ profileOpens: s.profileOpens.filter((g) => g !== grant) }));
  return true;
}

/**
 * Create the AI tab and load `url` into it, answering the request with the
 * creation ticket's result (or the reason it could not be created).
 */
export async function createAiTab(
  id: string,
  windowLabel: string,
  url: string,
  mode: AiMode,
  profile: string | undefined,
  deadline: number,
): Promise<void> {
  const tabId = useTabStore.getState().createBrowserTab(windowLabel, url, undefined, mode);
  try {
    await ensureBrowserNativeView(tabId, url, mode, profile);
    if (profile) useBrowserSessionStore.getState().recordProfileUse(profile, Date.now());
  } catch (error) {
    if (needsNavigationApproval(error)) {
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
}
