/**
 * browserAccess — the gates every browser handler shares (audit 2026-09-03).
 *
 * `browserGate` answers "may this window serve browser requests at all?" in the
 * order the client expects: an unsupported platform refuses with the
 * `UNSUPPORTED_PLATFORM` token the tool description promises (X-04 — the feature
 * defaults on everywhere while the surface is a stub off macOS, so this used to
 * read as `BROWSER_DISABLED` there), then the user's setting.
 *
 * `resolveBrowserTarget` is the envelope every handler opens with: that gate, then
 * the tab the request names (round 3, #62). The gate → tabId validation → tab
 * resolution → refusal sequence used to be copied into seven handlers, error
 * strings and all; here it is once, and a handler that needs a different tab
 * contract (`close` requires a tabId; `navigate` speaks `TAB_NOT_FOUND`) is the
 * one that does not call it.
 *
 * `invokeAttached` keeps the frontend's human-tab attachment mirror in step with
 * the driver (A-01). Rust spends a one-use attachment INSIDE `authorize_driver_op`,
 * before the eval runs, so a failure after authorization (a 5 s eval timeout, a
 * surface failure) has already spent it — while a refusal AT the gate (stale
 * generation, not granted, no committed page…) has not. The mirror used to be
 * spent only on a resolved invoke, in three of eight handlers; the others never
 * spent it. After any post-authorization failure the frontend believed the tab
 * was still attached, never re-prompted, and the driver refused every later
 * operation with `permission-denied` — a lockout until the tab navigated.
 *
 * A success is a certain spend and is mirrored directly. A REJECTION is not
 * classified here at all (round 4, #37): `browser_eval` can fail before the gate
 * too — a poisoned lock, a script over the size bound, a half-specified target —
 * and a token denylist read every one of those as "spent" while the driver kept
 * the attachment. So after a rejection the mirror is reconciled to the driver's
 * own report (`browserAttachmentMirror`), which fails safe toward one extra
 * prompt when the driver cannot be asked.
 *
 * @coordinates-with src-tauri/src/browser/authorize.rs — the consume order this mirrors
 * @coordinates-with services/mcpBridge/v2/browserAttachmentMirror — the post-rejection reconcile
 * @coordinates-with services/mcpBridge/v2/browserReadClass — read-class envelope
 * @coordinates-with services/mcpBridge/v2/browserAct — act-class envelope
 * @module services/mcpBridge/v2/browserAccess
 */
import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { isMacPlatform } from "@/utils/platform";
import { reconcileAttachmentMirror } from "./browserAttachmentMirror";
import { browserEnabled, readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";

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
 * The gate, then the tab the request names: `tabId` when supplied (refused when
 * supplied but not a non-empty string — an explicit tabId must never fall back to
 * the active tab, which could act on an unintended page), else this window's
 * active browser tab. Returns null once a refusal has been sent.
 */
export async function resolveBrowserTarget(
  id: string,
  args: Record<string, unknown>,
): Promise<BrowserTarget | null> {
  if (!(await browserGate(id))) return null;
  const tabIdArg = readTabIdArg(args);
  if (tabIdArg === null) {
    await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
    return null;
  }
  const tab = resolveBrowserTab(tabIdArg);
  if (!tab) {
    await respond({ id, success: false, error: "no active browser tab" });
    return null;
  }
  return tab;
}

/**
 * Run one driver call on `tab` and keep the attachment mirror in step with what
 * the driver did: spend it on success, and after a rejection set it to what the
 * driver reports it still holds (see `browserAttachmentMirror`). The original
 * rejection is rethrown either way. A non-human tab needs no attachment and this
 * is then just `run()`.
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
    await reconcileAttachmentMirror(tab);
    throw error;
  }
}

/** Is the tab attached with a ONE-USE attachment (spent by the next operation)? */
export function hasOnceAttachment(tab: BrowserTarget): boolean {
  return useBrowserApprovalStore
    .getState()
    .attachments.some((a) => a.tabId === tab.tabId && a.generation === tab.generation && a.once);
}
