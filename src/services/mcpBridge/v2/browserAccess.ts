/**
 * browserAccess — the two gates every browser handler shares (audit 2026-09-03).
 *
 * `browserGate` answers "may this window serve browser requests at all?" in the
 * order the client expects: an unsupported platform refuses with the
 * `UNSUPPORTED_PLATFORM` token the tool description promises (X-04 — the feature
 * defaults on everywhere while the surface is a stub off macOS, so this used to
 * read as `BROWSER_DISABLED` there), then the user's setting.
 *
 * `invokeAttached` keeps the frontend's human-tab attachment mirror in step with
 * the driver (A-01). Rust spends a one-use attachment INSIDE `authorize_driver_op`,
 * before the eval runs, so a failure after authorization (a 5 s eval timeout, a
 * surface failure) has already spent it — while a refusal AT the gate (stale
 * generation, not granted, no committed page…) has not. The mirror used to be
 * spent only on a resolved invoke, in three of eight handlers; the others never
 * spent it. After any post-authorization failure the frontend believed the tab
 * was still attached, never re-prompted, and the driver refused every later
 * operation with `permission-denied` — a lockout until the tab navigated. The
 * pre-authorization token list below is exactly the set of refusals
 * `authorize.rs` returns before its consume; everything else spends.
 *
 * @coordinates-with src-tauri/src/browser/authorize.rs — the consume order this mirrors
 * @coordinates-with src-tauri/src/browser/refusals.rs — the pre-authorization tokens
 * @coordinates-with services/mcpBridge/v2/browserReadClass — read-class envelope
 * @coordinates-with services/mcpBridge/v2/browserAct — act-class envelope
 * @module services/mcpBridge/v2/browserAccess
 */
import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { isMacPlatform } from "@/utils/platform";
import { bridgeErrorToken } from "./bridgeError";
import { browserEnabled, type BrowserTarget } from "./browserHelpers";

/** The native surface exists only on macOS (`surface_stub.rs` everywhere else). */
function browserSupportedHere(): boolean {
  return isMacPlatform();
}

/** The token the tool description promises for an unsupported platform. */
const UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM";

/**
 * Refuse-and-report unless this window may serve browser requests. Returns
 * whether the caller may proceed; on `false` a response has been sent.
 */
export async function browserGate(id: string): Promise<boolean> {
  if (!browserSupportedHere()) {
    await respond({
      id,
      success: false,
      error: `${UNSUPPORTED_PLATFORM}: the embedded browser is macOS-only in this build`,
      data: { token: UNSUPPORTED_PLATFORM },
    });
    return false;
  }
  if (!browserEnabled()) {
    await respond({ id, success: false, error: "BROWSER_DISABLED" });
    return false;
  }
  return true;
}

/**
 * Refusals `authorize_driver_op` returns BEFORE it spends an attachment. A
 * rejection carrying any other token (or none) came from after authorization,
 * where the driver has already spent it.
 */
const PRE_AUTHORIZATION_TOKENS: ReadonlySet<string> = new Set([
  "BROWSER_DISABLED",
  "STALE_COMMAND",
  "NO_COMMITTED_PAGE",
  "TAB_NOT_FOUND",
  "POLICY_STALE",
  "PROFILE_ORIGIN_CONFINED",
  "ATTACHMENT_REQUIRED",
  "NOT_GRANTED",
]);

/** Did the driver spend the attachment before this rejection? */
export function attachmentSpentBy(error: unknown): boolean {
  const token = bridgeErrorToken(error);
  return token === null || !PRE_AUTHORIZATION_TOKENS.has(token);
}

/**
 * Run one driver call on `tab` and keep the attachment mirror in step with what
 * the driver did: spend it on success and on every post-authorization failure,
 * leave it on a pre-authorization refusal. A non-human tab needs no attachment
 * and this is then just `run()`.
 */
export async function invokeAttached<T>(tab: BrowserTarget, run: () => Promise<T>): Promise<T> {
  const approvals = useBrowserApprovalStore.getState();
  const attached =
    tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation);
  if (!attached) return run();
  try {
    const result = await run();
    useBrowserApprovalStore.getState().consumeHumanTabAttachment(tab.tabId, tab.generation);
    return result;
  } catch (error) {
    if (attachmentSpentBy(error)) {
      useBrowserApprovalStore.getState().consumeHumanTabAttachment(tab.tabId, tab.generation);
    }
    throw error;
  }
}

/** Is the tab attached with a ONE-USE attachment (spent by the next operation)? */
export function hasOnceAttachment(tab: BrowserTarget): boolean {
  return useBrowserApprovalStore
    .getState()
    .attachments.some((a) => a.tabId === tab.tabId && a.generation === tab.generation && a.once);
}
