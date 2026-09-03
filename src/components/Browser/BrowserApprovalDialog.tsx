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
 * An attach approval is an IPC in flight until confirmed; the buttons are disabled
 * while it is (`resolving` in the store), so a second click cannot start a
 * concurrent attach whose completion order would decide the final authority.
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
 * Prompt-swap protection (audit 2026-09-03 A-02): the head of the queue can be
 * removed asynchronously by things the AI controls — cancelling its own workflow
 * run withdraws that run's prompt, a sandbox navigation dismisses a tab's prompts —
 * so the NEXT prompt could render under a click the user aimed at the previous
 * one. Two rules make that click a no-op: an Allow within `ACTIVATION_DELAY_MS`
 * of the prompt (re)rendering is ignored, and a pointer Allow must have started
 * (pointerdown) on the SAME request it completes on. Deny is never delayed.
 *
 * Display hardening (A-05, S-09): page-derived names are bidi-isolated and
 * length-capped, and a payload-binding operation shows what it binds.
 *
 * @coordinates-with stores/browserApprovalStore — pending queue + resolveApproval
 * @coordinates-with services/browser/browserOcclusion — freeze while raised
 * @coordinates-with services/browser/grantSync — pushes the resulting grant/one-shot to Rust
 * @module components/Browser/BrowserApprovalDialog
 */
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserApprovalStore, type ApprovalOutcome } from "@/stores/browserApprovalStore";
import { NEVER_GRANTABLE } from "@/lib/browser/approval/grants";
import { OCCLUDER } from "@/services/browser/browserOcclusion";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";
import { approvalDenied } from "@/services/browser/browserTabLifecycle";
import { ACTIVATION_DELAY_MS, clipName, displayOrigin } from "./approvalDialogFormat";
import { useApprovalDialogKeyboard } from "./useApprovalDialogKeyboard";
import "./browser-approval-dialog.css";


export function BrowserApprovalDialog(): React.ReactElement | null {
  const { t } = useTranslation("common");
  // One prompt at a time: each request is a separate decision, and stacking them
  // would invite the user to click through a queue.
  const request = useBrowserApprovalStore((s) => s.pending[0] ?? null);
  const resolving = useBrowserApprovalStore((s) => s.resolving);
  const denyRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Prompt-swap protection — see the header. `armedAt` is when THIS request
  // started rendering; `pointerDownFor` is the request a pointer Allow began on.
  const armedAtRef = useRef(0);
  const pointerDownForRef = useRef<string | null>(null);

  const requestId = request?.id;

  useEffect(() => {
    armedAtRef.current = Date.now();
    pointerDownForRef.current = null;
  }, [requestId]);

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

  useApprovalDialogKeyboard(requestId, denyRef, dialogRef, (id) => {
    const current = useBrowserApprovalStore.getState().pending.find((p) => p.id === id);
    if (current) approvalDenied(current);
  });

  if (!request) return null;

  const resolve = (outcome: ApprovalOutcome, event?: ReactMouseEvent<HTMLButtonElement>) => {
    if (outcome === "deny") {
      // A denial also discards an AI tab that was only waiting for this approval to load.
      approvalDenied(request);
      return;
    }
    {
      // Too soon after this prompt appeared: the click was aimed at its predecessor.
      if (Date.now() - armedAtRef.current < ACTIVATION_DELAY_MS) return;
      // A pointer activation (detail > 0) must have STARTED on this same request; a
      // keyboard activation (detail === 0) has no pointerdown and relies on the delay.
      if (event && event.detail > 0 && pointerDownForRef.current !== request.id) return;
    }
    useBrowserApprovalStore.getState().resolveApproval(request.id, outcome);
  };
  const armPointer = () => {
    pointerDownForRef.current = request.id;
  };

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
  // A payload-binding op with a human summary (type/key/scroll) shows the summary,
  // not the built script the summary describes.
  const payload = request.payloadSummary !== undefined ? undefined : request.script;
  // A `session` payload is a saved-login HANDLE, not a script; rendering it in a
  // <pre> under a "Script" heading misdescribed what was being approved.
  const payloadIsScript = request.operation !== "session";
  // A never-grantable operation (eval) cannot become a standing grant — offering
  // "Allow on this site" would be a button that silently does nothing (the grant is
  // sanitized away), which is misleading security UX (Security review P5, Low #5).
  const grantable = !NEVER_GRANTABLE.has(request.operation);
  // An attach approval is an IPC in flight until it is confirmed; while it is, a
  // second click must not start a concurrent attach (the store guards it too).
  const busy = resolving.includes(request.id);

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
          <dd className="browser-approval-origin">
            <bdi>{origin}</bdi>
          </dd>

          <dt>{t("browser.approval.action")}</dt>
          <dd>{operation}</dd>

          {request.profile !== undefined && (
            <>
              <dt>{t("browser.profiles.label")}</dt>
              <dd>
                <span className="browser-approval-name">
                  “<bdi>{clipName(request.profile)}</bdi>”
                </span>
              </dd>
            </>
          )}

          {request.target && (
            <>
              <dt>{t("browser.approval.element")}</dt>
              <dd>
                <span className="browser-approval-role">
                  <bdi>{clipName(request.target.role)}</bdi>
                </span>{" "}
                <span className="browser-approval-name">
                  “<bdi>{clipName(request.target.name)}</bdi>”
                </span>
              </dd>
            </>
          )}

          {request.payloadSummary !== undefined && (
            <>
              <dt>{t("browser.approval.details")}</dt>
              <dd>
                <span className="browser-approval-name">
                  <bdi>{clipName(request.payloadSummary)}</bdi>
                </span>
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
                  <span className="browser-approval-name">
                    “<bdi>{clipName(payload)}</bdi>”
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>

        <p className="browser-approval-note">
          {t("browser.approval.note")}
          {/* "Site permissions last until VMark quits" describes a standing grant: it
              is wrong for an attachment ("until navigation") and for a one-shot-only
              operation, which offers no such button. */}
          {grantable && !attachment ? ` ${t("browser.approval.sessionNote")}` : ""}
        </p>

        <div className="browser-approval-actions">
          <button
            type="button"
            ref={denyRef}
            className="vm-btn"
            disabled={busy}
            onClick={() => resolve("deny")}
          >
            {t("browser.approval.deny")}
          </button>
          <button
            type="button"
            className="vm-btn"
            disabled={busy}
            onPointerDown={armPointer}
            onClick={(e) => resolve("once", e)}
          >
            {t("browser.approval.allowOnce")}
          </button>
          {grantable && (
            <button
              type="button"
              className="vm-btn vm-btn--primary"
              disabled={busy}
              onPointerDown={armPointer}
              onClick={(e) => resolve("remember", e)}
            >
              {t(attachment ? "browser.approval.allowTab" : "browser.approval.allowSite")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
