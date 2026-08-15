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
import { NEVER_GRANTABLE } from "@/lib/browser/approval/grants";
import { OCCLUDER } from "@/services/browser/browserOcclusion";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";
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
  const dialogRef = useRef<HTMLDivElement>(null);

  const requestId = request?.id;

  // Freeze EVERY mounted browser, not just the tab being asked about.
  //
  // The prompt is a full-window overlay, and every native browser view paints over all
  // DOM in its own rect. Freezing only the target tab left any OTHER mounted browser — a
  // second pane in split view — free to paint over the consent dialog and draw whatever it
  // liked on top of it, including a convincing forgery of this very prompt. A security
  // question that an attacker-controlled page can redraw is not a security question.
  // (Audit finding, High.)
  //
  // Reference-counted, so this does not disturb a crash overlay or page dialog already
  // freezing one of those tabs. Keyed on `requestId` only through `active`: consecutive
  // requests for the same tab must NOT thaw-and-refreeze between prompts, which would open
  // an asynchronous window with the page visible and a dialog on screen.
  useBrowserOccluder(Boolean(requestId), OCCLUDER.approval);

  // Deny holds focus: a stray Enter must never authorize an action. The element
  // focused BEFORE the prompt is remembered so it can be restored on close —
  // otherwise resolving a prompt dropped focus to <body> and a keyboard user lost
  // their place in the app (audit 20260815-163607 #22).
  useEffect(() => {
    if (!requestId) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    denyRef.current?.focus();
    return () => {
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Fail closed. Dismissing a security prompt is a denial, never an approval.
      if (e.key === "Escape") {
        e.preventDefault();
        // EXCLUSIVE: while a security prompt is raised it is the only Escape
        // handler. There is no modal stack, so a sibling overlay's window-level
        // listener also saw this keystroke and one Escape resolved two separate
        // decisions — one of them unseen by the user (audit #23). Capture phase
        // plus stopImmediatePropagation makes this prompt win deterministically
        // instead of depending on listener registration order.
        e.stopPropagation();
        e.stopImmediatePropagation();
        useBrowserApprovalStore.getState().resolveApproval(requestId, "deny");
        return;
      }
      // Trap Tab inside the dialog. `aria-modal` tells assistive tech the rest of
      // the app is inert; it does NOT make it inert for the Tab key, so focus
      // could walk out of a security prompt and into the background UI while the
      // prompt was still open (audit #22).
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [requestId]);

  if (!request) return null;

  const resolve = (outcome: ApprovalOutcome) =>
    useBrowserApprovalStore.getState().resolveApproval(request.id, outcome);

  const origin = displayOrigin(request.targetUrl);
  const operation = t(`browser.approval.operation.${request.operation}`, request.operation);
  const attachment = request.operation === "attach";
  // The user MUST see the exact payload they authorize, not just the op
  // (Security review P5, High #1; WI-P6.3).
  //
  // Driven by PRESENCE, not by a hardcoded operation list. The list said
  // ["eval","session"] while the store records a script for `style` too, so an
  // AI-chosen stylesheet was authorised unseen — a list in the view duplicating
  // knowledge the store owns, which drifted the moment `style` was added
  // (audit 20260815-163607 #21). Anything that carries a payload now shows it.
  const payload = request.script;
  // A `session` payload is a saved-login HANDLE, not a script; rendering it in a
  // <pre> under a "Script" heading misdescribed what was being approved.
  const payloadIsScript = request.operation !== "session";
  // A never-grantable operation (eval) cannot become a standing grant — offering
  // "Allow on this site" would be a button that silently does nothing (the grant is
  // sanitized away), which is misleading security UX (Security review P5, Low #5).
  const grantable = !NEVER_GRANTABLE.has(request.operation);

  return (
    <div className="browser-approval-backdrop">
      <div
        ref={dialogRef}
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

          {request.profile !== undefined && (
            <>
              <dt>{t("browser.profiles.label")}</dt>
              <dd>
                <span className="browser-approval-name">“{request.profile}”</span>
              </dd>
            </>
          )}

          {request.target && (
            <>
              <dt>{t("browser.approval.element")}</dt>
              <dd>
                <span className="browser-approval-role">{request.target.role}</span>{" "}
                <span className="browser-approval-name">“{request.target.name}”</span>
              </dd>
            </>
          )}

          {payload !== undefined && (
            <>
              <dt>
                {payloadIsScript
                  ? t("browser.approval.script")
                  : t("browser.approval.sessionHandle")}
              </dt>
              <dd>
                {payloadIsScript ? (
                  <pre className="browser-approval-script">{payload}</pre>
                ) : (
                  <span className="browser-approval-name">“{payload}”</span>
                )}
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
            className="vm-btn"
            onClick={() => resolve("deny")}
          >
            {t("browser.approval.deny")}
          </button>
          <button
            type="button"
            className="vm-btn"
            onClick={() => resolve("once")}
          >
            {t("browser.approval.allowOnce")}
          </button>
          {grantable && (
            <button
              type="button"
              className="vm-btn vm-btn--primary"
              onClick={() => resolve("remember")}
            >
              {t(attachment ? "browser.approval.allowTab" : "browser.approval.allowSite")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
