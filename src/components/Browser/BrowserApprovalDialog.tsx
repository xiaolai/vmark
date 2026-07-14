/**
 * BrowserApprovalDialog — the human half of the browser security model (WI-S0.8).
 *
 * Purpose: render the queue of approval requests the MCP browser tools raise before
 * the AI acts, and let the user resolve them. The enforcement half of this model
 * (origin guard, standing grants, one-shots bound to tab + generation + origin +
 * operation + target, R7a navigation expiry) was already built and audited — but
 * nothing ever rendered `pending` or called `resolveApproval`, so the AI's `act` path
 * was permanent-deny and the "human in the loop" had no way to be in the loop. This
 * closes that.
 *
 * **It shows the descriptor, not the page.** The authorization is bound to exactly
 * (origin, operation, element role+name) — so that is what the user is asked to
 * approve. Rendering the page instead would be strictly *weaker*: the page controls
 * its own pixels and could dress a "Delete everything" button up as "Publish", and
 * the user would be consenting to a picture rather than to the tuple the gate
 * enforces. The origin shown is the *committed* one, recorded by Rust from the
 * webview itself, never the page's claim about itself.
 *
 * Occlusion: the native view paints over all DOM in its rect, so the dialog registers
 * as an occluder (freeze) while it is up and releases it on resolve. Because it shows
 * text rather than the page, an opaque hide-only freeze is sufficient — this dialog
 * does not depend on the snapshot work (Phase OC).
 *
 * Fail-closed: Escape denies, and Deny holds focus, so a stray Enter can never
 * authorize an action.
 *
 * @coordinates-with stores/browserApprovalStore — pending queue + resolveApproval
 * @coordinates-with services/browser/browserOcclusion — freeze while raised
 * @coordinates-with services/browser/grantSync — pushes the resulting grant/one-shot to Rust
 * @module components/Browser/BrowserApprovalDialog
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserApprovalStore, type ApprovalOutcome } from "@/stores/browserApprovalStore";
import { browserOcclusion, OCCLUDER } from "@/services/browser/browserOcclusion";
import { canonicalizeOrigin } from "@/lib/browser/origin/originGuard";
import "./browser-approval-dialog.css";

/** The committed origin as `scheme://host[:port]`, or the raw url if it is opaque
 *  (about:/data:) — an opaque origin can be neither granted nor authorized once, so
 *  the dialog still names it rather than showing a blank. */
function displayOrigin(url: string): string {
  const origin = canonicalizeOrigin(url);
  if (!origin) return url;
  const defaultPort = origin.scheme === "https" ? 443 : 80;
  return origin.port === defaultPort
    ? `${origin.scheme}://${origin.host}`
    : `${origin.scheme}://${origin.host}:${origin.port}`;
}

export function BrowserApprovalDialog(): React.ReactElement | null {
  const { t } = useTranslation("common");
  // One prompt at a time: each request is a separate decision, and stacking them
  // would invite the user to click through a queue.
  const request = useBrowserApprovalStore((s) => s.pending[0] ?? null);
  const denyRef = useRef<HTMLButtonElement>(null);

  const tabId = request?.tabId;
  const requestId = request?.id;

  // Freeze the tab's native view while the prompt is up, so it cannot paint over the
  // very dialog asking whether it may be acted upon. Reference-counted, so a crash
  // overlay or page dialog already freezing this tab is not disturbed.
  useEffect(() => {
    if (!tabId) return;
    browserOcclusion.addOccluder(tabId, OCCLUDER.approval);
    return () => browserOcclusion.removeOccluder(tabId, OCCLUDER.approval);
  }, [tabId, requestId]);

  // Deny holds focus: a stray Enter must never authorize an action.
  useEffect(() => {
    if (requestId) denyRef.current?.focus();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Fail closed. Dismissing a security prompt is a denial, never an approval.
      if (e.key === "Escape") {
        e.preventDefault();
        useBrowserApprovalStore.getState().resolveApproval(requestId, "deny");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestId]);

  if (!request) return null;

  const resolve = (outcome: ApprovalOutcome) =>
    useBrowserApprovalStore.getState().resolveApproval(request.id, outcome);

  const origin = displayOrigin(request.targetUrl);
  const operation = t(`browser.approval.operation.${request.operation}`, request.operation);

  return (
    <div className="browser-approval-backdrop">
      <div
        className="browser-approval"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="browser-approval-title"
      >
        <h2 className="browser-approval-title" id="browser-approval-title">
          {t("browser.approval.title")}
        </h2>

        <dl className="browser-approval-descriptor">
          <dt>{t("browser.approval.site")}</dt>
          <dd className="browser-approval-origin">{origin}</dd>

          <dt>{t("browser.approval.action")}</dt>
          <dd>{operation}</dd>

          {request.target && (
            <>
              <dt>{t("browser.approval.element")}</dt>
              <dd>
                <span className="browser-approval-role">{request.target.role}</span>{" "}
                <span className="browser-approval-name">“{request.target.name}”</span>
              </dd>
            </>
          )}
        </dl>

        <p className="browser-approval-note">
          {t("browser.approval.note")} {t("browser.approval.sessionNote")}
        </p>

        <div className="browser-approval-actions">
          <button
            type="button"
            ref={denyRef}
            className="browser-approval-btn browser-approval-btn--deny"
            onClick={() => resolve("deny")}
          >
            {t("browser.approval.deny")}
          </button>
          <button
            type="button"
            className="browser-approval-btn"
            onClick={() => resolve("once")}
          >
            {t("browser.approval.allowOnce")}
          </button>
          <button
            type="button"
            className="browser-approval-btn browser-approval-btn--remember"
            onClick={() => resolve("remember")}
          >
            {t("browser.approval.allowSite")}
          </button>
        </div>
      </div>
    </div>
  );
}
