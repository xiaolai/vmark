/**
 * BrowserOverlays — everything that stands in for the native page (WI-S0.9 / WI-SOC.1b).
 *
 * The native `WKWebView` paints over all DOM in its rect, so whenever VMark needs to
 * show something *there* — a frozen placeholder, a load failure, a crash, a page dialog
 * — the native view is hidden and one of these takes its place. All four are therefore
 * **opaque and fill the rect**: they replace a view that is either absent (create failed)
 * or hidden (frozen), and a translucent one would show the blank hole where the page used
 * to be.
 *
 * Precedence, most severe first: a crash beats a failed load (the content process died,
 * which is the bigger fact and needs a different recovery), and the frozen placeholder
 * sits underneath everything as the opaque floor.
 *
 * Split from BrowserSurface, which owns the native view's lifecycle. This is pure
 * presentation — no stores, no invoke — so it is cheap to test and cheap to reason
 * about, and the surface stays about the webview. Its one effect is the modal focus
 * contract: a page dialog takes focus on open (OK, the safe default) and hands it back
 * to whatever had it when it closes (audit 2026-09-03 round 2, #161).
 *
 * A page dialog whose answer did not reach the page keeps standing, with the failure
 * painted inside it as a live alert and both buttons live (audit round 3, #164): the
 * surface owns the retry, this only shows why the last click went nowhere.
 *
 * @coordinates-with components/Browser/BrowserSurface — owns the state, passes it down
 * @module components/Browser/BrowserOverlays
 */
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserDialog, CrashAction } from "@/stores/browserUiStore";
import { urlForAgent } from "@/lib/browser/url";

export interface BrowserOverlaysProps {
  /** The native view is hidden by an occluder — paint the opaque floor (WI-SOC.1b). */
  frozen: boolean;
  /** The last failure on this tab, or null (WI-S0.9). */
  error: string | null;
  /** Non-null while the web content process is down (WI-1.8). */
  crash: { action: CrashAction } | null;
  /** Non-null while a page JS dialog is open (WI-1.7). */
  dialog: BrowserDialog | null;
  /** Why the last answer to `dialog` did not reach the page, or null. Shown inside
   *  the dialog, which stays up so the user can answer again (audit round 3, #164). */
  dialogError: string | null;
  /** The last popup the page tried to open and VMark blocked (audit X-03), or null. */
  popup: { url: string; at: number } | null;
  onRetry: () => void;
  onCloseDialog: (accepted: boolean) => void;
  onRecover: () => void;
  onOpenPopup: () => void;
  onDismissPopup: () => void;
}

export function BrowserOverlays({
  frozen,
  error,
  crash,
  dialog,
  dialogError,
  popup,
  onRetry,
  onCloseDialog,
  onRecover,
  onOpenPopup,
  onDismissPopup,
}: BrowserOverlaysProps): React.ReactElement | null {
  const { t } = useTranslation("common");
  const okRef = useRef<HTMLButtonElement>(null);
  // A crash outranks a dialog (see below), so the modal contract follows the SHOWN dialog.
  const shownDialog = dialog && !crash ? dialog : null;
  useLayoutEffect(() => {
    if (!shownDialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    okRef.current?.focus();
    return () => {
      // Restore only what is still in the document: a control unmounted meanwhile
      // has nothing to return to, and focusing it would silently do nothing anyway.
      if (previous?.isConnected) previous.focus();
    };
  }, [shownDialog]);

  if (!frozen && !error && !crash && !dialog && !popup) return null;

  return (
    <>
      {/* A blocked popup used to vanish with a debug log — a click that "did nothing".
          Not a full-cover overlay: the page stays live; this is a bar along the top of
          the rect offering the URL the page wanted. Query/fragment are not shown. */}
      {popup && (
        <div className="browser-popup-notice" role="status">
          <span className="browser-popup-notice-text">
            {t("browser.popupBlocked")}: <bdi>{urlForAgent(popup.url)}</bdi>
          </span>
          <button type="button" className="vm-btn vm-btn--compact" onClick={onOpenPopup}>
            {t("browser.popupOpen")}
          </button>
          <button
            type="button"
            className="vm-btn vm-btn--compact vm-btn--plain"
            onClick={onDismissPopup}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
      )}
      {/* The opaque floor: the native view is hidden, and without this the rect is a
          blank hole that a translucent overlay would composite over. */}
      {frozen && <div className="browser-frozen" aria-hidden="true" />}

      {/* A crash outranks a dialog: Rust has already drained the dialog when the process
          died, so a dialog left in state would sit ABOVE the recovery UI it no longer
          belongs to. */}
      {dialog && !crash && (
        <div
          className="browser-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label={dialog.message}
          onKeyDown={(e) => {
            // A modal owns Escape and Tab: Escape cancels a confirm (dismisses an alert),
            // Tab cycles within the dialog's own buttons instead of wandering into the
            // hidden native view or unrelated chrome.
            if (e.key === "Escape") {
              e.preventDefault();
              onCloseDialog(dialog.kind !== "confirm");
              return;
            }
            if (e.key !== "Tab") return;
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            if (buttons.length === 0) return;
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.shiftKey
              ? buttons[(index - 1 + buttons.length) % buttons.length]
              : buttons[(index + 1) % buttons.length];
            e.preventDefault();
            next?.focus();
          }}
        >
          <p className="browser-dialog-message">{dialog.message}</p>
          {dialogError && (
            <p className="browser-dialog-error" role="alert">
              {t("browser.dialog.answerFailed")}
              <span className="browser-dialog-error-detail">{dialogError}</span>
            </p>
          )}
          <div className="browser-dialog-actions">
            {dialog.kind === "confirm" && (
              <button
                type="button"
                className="browser-dialog-btn"
                onClick={() => onCloseDialog(false)}
              >
                {t("cancel")}
              </button>
            )}
            <button
              type="button"
              className="browser-dialog-btn browser-dialog-btn--primary"
              // The safe default takes focus (see the layout effect above): Enter
              // answers OK/dismiss, never a stray control behind the modal.
              ref={okRef}
              onClick={() => onCloseDialog(true)}
            >
              {t("ok")}
            </button>
          </div>
        </div>
      )}

      {crash && (
        <div className="browser-crash-overlay" role="alert">
          <p className="browser-crash-message">{t("browser.crashed")}</p>
          {crash.action === "manual" ? (
            <button type="button" className="browser-crash-reload" onClick={onRecover}>
              {t("browser.reload")}
            </button>
          ) : (
            <span className="browser-crash-reloading">{t("browser.reloading")}</span>
          )}
        </div>
      )}

      {/* A failed load used to be indistinguishable from a slow one: a blank rect and a
          spinner, forever. A crash outranks it — the process died, which needs a
          different recovery than "try again". */}
      {error && !crash && !dialog && (
        <div className="browser-error" role="alert">
          <p className="browser-error-message">{t("browser.error.title")}</p>
          <p className="browser-error-detail">{error}</p>
          <button type="button" className="browser-error-retry" onClick={onRetry}>
            {t("browser.error.retry")}
          </button>
        </div>
      )}
    </>
  );
}
