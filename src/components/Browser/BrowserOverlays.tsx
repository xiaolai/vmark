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
 * presentation — no stores, no invoke, no effects — so it is cheap to test and cheap to
 * reason about, and the surface stays about the webview.
 *
 * @coordinates-with components/Browser/BrowserSurface — owns the state, passes it down
 * @module components/Browser/BrowserOverlays
 */
import { useTranslation } from "react-i18next";
import type { BrowserDialog, CrashAction } from "./useBrowserNavEvents";

export interface BrowserOverlaysProps {
  /** The native view is hidden by an occluder — paint the opaque floor (WI-SOC.1b). */
  frozen: boolean;
  /** The last failure on this tab, or null (WI-S0.9). */
  error: string | null;
  /** Non-null while the web content process is down (WI-1.8). */
  crash: { action: CrashAction } | null;
  /** Non-null while a page JS dialog is open (WI-1.7). */
  dialog: BrowserDialog | null;
  onRetry: () => void;
  onCloseDialog: (accepted: boolean) => void;
  onRecover: () => void;
}

export function BrowserOverlays({
  frozen,
  error,
  crash,
  dialog,
  onRetry,
  onCloseDialog,
  onRecover,
}: BrowserOverlaysProps): React.ReactElement | null {
  const { t } = useTranslation("common");

  if (!frozen && !error && !crash && !dialog) return null;

  return (
    <>
      {/* The opaque floor: the native view is hidden, and without this the rect is a
          blank hole that a translucent overlay would composite over. */}
      {frozen && <div className="browser-frozen" aria-hidden="true" />}

      {dialog && (
        <div className="browser-dialog" role="alertdialog" aria-label={dialog.message}>
          <p className="browser-dialog-message">{dialog.message}</p>
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
