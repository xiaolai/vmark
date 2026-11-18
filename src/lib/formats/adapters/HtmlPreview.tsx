/**
 * Standalone HTML preview — sandboxed by default, trusted by explicit consent.
 *
 * Purpose: render a `.html` / `.htm` document in one of two modes, own the
 * transition between them, and zoom the rendered page (issue #1704)
 * independently of the editor font size.
 *
 * | Mode | Frame | Scripts |
 * |---|---|---|
 * | safe (default, ADR-4) | `srcdoc` + `sandbox=""` + DOMPurify + meta CSP | blocked |
 * | trusted (issue #1273) | `src=vmark-trusted://…` + `sandbox="allow-scripts"` | run, opaque origin |
 *
 * The two modes are not two configurations of one frame: a `srcdoc` document
 * inherits the app's `script-src 'self'`, so trusted content has to arrive from
 * an origin of its own. `htmlTrust.ts` holds the vocabulary and
 * `src-tauri/src/trusted_html/` the origin.
 *
 * A trusted preview NEVER re-runs itself. Editing the source marks it stale and
 * waits for Reload — re-executing a document is an action the user takes, and a
 * running simulation surviving a keystroke is the behaviour the feature is for.
 *
 * The corollary, and the thing issue #1328 was: when the pane cannot know what
 * the frame is running — a remount, or a file trusted earlier in the session —
 * it says so rather than claiming currency. It still does not act.
 *
 * Diagnostics are NOT echoed here. HTML always renders, so none is a "cannot
 * render"; the source pane's validation list shows each with its message,
 * severity and a jump. A strip here once showed a bare red "(6:1)" for a
 * warning, under the "scripts enabled" banner.
 *
 * This file renders those two modes. The trust lifecycle behind them — what
 * the frame is running, whether that is stale, and the guarded Enable / Reload
 * / Revoke actions — is `useHtmlTrust`.
 *
 * @coordinates-with useHtmlTrust.ts — the trust lifecycle
 * @coordinates-with htmlZoom.ts, HtmlZoomBar.tsx — the page zoom
 * @module lib/formats/adapters/HtmlPreview
 */

import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { HtmlTrustBar } from "./HtmlTrustBar";
import { HtmlZoomBar } from "./HtmlZoomBar";
import { useHtmlTrust } from "./useHtmlTrust";
import { TRUSTED_ALLOW, TRUSTED_SANDBOX, trustedFrameUrl } from "./htmlTrust";
import { HTML_ZOOM_DEFAULT_PERCENT, stepZoomPercent } from "./htmlZoom";
import type { PreviewRendererProps } from "../types";
import "./html-preview.css";

const CSP_CONTENT =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';";

/**
 * The SAFE path, unchanged from ADR-4 in intent: DOMPurify first, then an empty
 * sandbox, then a meta CSP restricting what the frame may load.
 *
 * The meta is inserted through the DOM, not spliced in with a regex, and that
 * is a correctness requirement rather than a style preference. Two successive
 * regexes got this wrong. The first matched `<head` plus one delimiter, so
 * `<head lang="en">` became `<head <meta …>lang="en">`. Its replacement,
 * `/<head\b[^>]*>/i`, stops at the first `>` — and HTML attribute
 * serialization escapes `&` and `"` but NOT `>`, so DOMPurify passes
 * `<head title="a>b">` straight through. The regex then matched
 * `<head title="a>` and spliced the meta INSIDE the attribute value, leaving
 * the sandboxed document with NO policy element at all.
 *
 * A parser cannot be confused by a `>` inside an attribute, so the whole class
 * goes away. `DOMParser` with `text/html` always synthesises `html`/`head`/
 * `body`, which also removes the separate no-head fallback branch that existed
 * only because a regex could miss.
 */
function buildSandboxedSrcdoc(content: string): string {
  const sanitized = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|data:image\/):|[^a-z]|$)/i,
  });
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", CSP_CONTENT);
  // FIRST child of head: a policy that follows a resource-loading element
  // would not govern it.
  doc.head.insertBefore(meta, doc.head.firstChild);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

// `diagnostics` is deliberately unused: HTML always renders, and the source
// pane's validation list shows each diagnostic with its message and a jump.
export function HtmlPreview({
  content,
  liveContent,
  path,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");

  const { token, trusted, stale, error, runCount, onEnable, onReload, onRevoke } =
    useHtmlTrust(path, liveContent);

  const srcdoc = useMemo(
    () => (trusted ? null : buildSandboxedSrcdoc(content)),
    [content, trusted],
  );

  // #1704: the rendered page's own zoom, independent of the editor font size
  // (View → Zoom In only changes that). Held here, not in the bar, so the one
  // value drives the frame's `zoom`, the bar's label, and its disabled ends.
  const [zoomPercent, setZoomPercent] = useState(HTML_ZOOM_DEFAULT_PERCENT);
  const zoomStyle = { zoom: zoomPercent / 100 } as CSSProperties;
  const handleZoomOut = () => setZoomPercent((p) => stepZoomPercent(p, -1));
  const handleZoomIn = () => setZoomPercent((p) => stepZoomPercent(p, 1));
  const handleResetZoom = () => setZoomPercent(HTML_ZOOM_DEFAULT_PERCENT);

  // An empty document used to return before the trust bar rendered, which took
  // the REVOKE control away while the grant stayed live — clearing the buffer
  // silently removed the only off switch. The placeholder now replaces the
  // frame, not the whole pane.
  const empty = !content.trim();

  return (
    <div className="html-preview">
      {/* The security review's pending-sign-off notice, unchanged. It is a statement about
          the SANDBOXED path, so it stays with that path rather than following
          the user into trusted mode, which is a different mechanism with its
          own reasoning recorded in src-tauri/src/trusted_html/. */}
      {!trusted && !empty && (
        <div
          className="html-preview__sign-off-pending"
          role="status"
          data-testid="html-preview-sign-off-pending"
        >
          {t("preview.signOffPending")}
        </div>
      )}
      <HtmlTrustBar
        documentKey={path}
        trusted={trusted}
        stale={stale}
        canTrust={Boolean(path)}
        error={error}
        onEnable={onEnable}
        onRevoke={onRevoke}
        onReload={onReload}
      />
      {empty ? (
        <div className="html-preview__empty-slot" data-testid="html-preview-empty" />
      ) : (
        <>
          <div className="html-preview__viewport">
            {trusted && token ? (
              <iframe
                // Opaque origin: `allow-scripts` WITHOUT `allow-same-origin`, so the
                // document cannot read this one, cannot reach Tauri, and cannot
                // rewrite its own sandbox attribute.
                sandbox={TRUSTED_SANDBOX}
                allow={TRUSTED_ALLOW}
                title={t("preview.htmlIframeTitle")}
                src={`${trustedFrameUrl(token)}?run=${runCount}`}
                className="html-preview__iframe"
                referrerPolicy="no-referrer"
                style={zoomStyle}
              />
            ) : (
              <iframe
                // Empty sandbox: no scripts, no same-origin, no forms, no popups.
                sandbox=""
                title={t("preview.htmlIframeTitle")}
                srcDoc={srcdoc ?? ""}
                className="html-preview__iframe"
                referrerPolicy="no-referrer"
                style={zoomStyle}
              />
            )}
          </div>
          <HtmlZoomBar
            zoomPercent={zoomPercent}
            onZoomOut={handleZoomOut}
            onZoomIn={handleZoomIn}
            onReset={handleResetZoom}
          />
        </>
      )}
    </div>
  );
}
