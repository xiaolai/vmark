/**
 * Standalone HTML preview — sandboxed by default, trusted by explicit consent.
 *
 * Purpose: render a `.html` / `.htm` document in one of two modes, and own the
 * transition between them.
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
 * @module lib/formats/adapters/HtmlPreview
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { commandErrorMessage } from "@/services/commands/commandError";
import {
  grantTrustedHtml,
  publishTrustedHtml,
  revokeTrustedHtml,
} from "@/services/trustedHtml/trustedHtmlBridge";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { HtmlTrustBar } from "./HtmlTrustBar";
import { TRUSTED_ALLOW, TRUSTED_SANDBOX, trustedFrameUrl } from "./htmlTrust";
import type { PreviewRendererProps } from "../types";
import "./html-preview.css";

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:; base-uri \'none\';">';

/**
 * The SAFE path, unchanged from ADR-4: DOMPurify first, then an empty sandbox,
 * then a meta CSP restricting what the frame may load.
 */
function buildSandboxedSrcdoc(content: string): string {
  const sanitized = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|data:image\/):|[^a-z]|$)/i,
  });
  // Replace the WHOLE opening tag, not its first two characters. The previous
  // form matched `<head` plus one delimiter and re-emitted them with the meta
  // spliced in, so `<head lang="en">` became `<head <meta …>lang="en">` —
  // malformed markup in which the CSP may not apply at all. This is the SAFE
  // path, so that failure mode was the more dangerous of the two.
  const openingHead = /<head\b[^>]*>/i;
  if (openingHead.test(sanitized)) {
    return sanitized.replace(openingHead, (tag) => `${tag}${CSP_META}`);
  }
  return `<!doctype html><html><head>${CSP_META}</head><body>${sanitized}</body></html>`;
}

export function HtmlPreview({
  content,
  liveContent,
  path,
  diagnostics,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const token = useHtmlTrustStore((s) => (path ? (s.grants[path] ?? null) : null));

  /** The content the trusted frame is currently running. */
  const [ran, setRan] = useState<string | null>(null);
  /** Bumped on Reload so the frame refetches the same token. */
  const [runCount, setRunCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A pane can render a different document without remounting, and `ran`
  // describes the PREVIOUS one. Left alone it reports a freshly-opened trusted
  // file as stale against content it never ran. Adjusted during render rather
  // than in an effect, same as HtmlTrustBar's confirmation reset.
  const [ranPath, setRanPath] = useState(path);
  if (ranPath !== path) {
    setRanPath(path);
    setRan(null);
    setError(null);
  }

  const trusted = token !== null;
  // Staleness and every ACTION below use `liveContent`, never the deferred
  // `content`: executing the document the user can no longer see would be a
  // correctness bug, and comparing against a lagging value would report a
  // freshly-reloaded preview as stale.
  const stale = trusted && ran !== null && ran !== liveContent;

  /**
   * One guarded runner for both actions.
   *
   * `busy` is a ref, not state: the guard has to reject a second click within
   * the same tick, before any re-render could deliver a new prop. Without it,
   * a double-click on Enable mints two backend grants and the store keeps only
   * the second — orphaning the first, which still occupies a `MAX_GRANTS` slot
   * that nothing can ever free.
   */
  const busy = useRef(false);
  const run = useCallback(
    (operation: (html: string) => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      const html = liveContent;
      void (async () => {
        try {
          await operation(html);
          setRan(html);
          setRunCount((n) => n + 1);
        } catch (e) {
          setError(t("preview.htmlTrustFailed", { error: commandErrorMessage(e) }));
        } finally {
          busy.current = false;
        }
      })();
    },
    [liveContent, t],
  );

  const handleEnable = useCallback(
    () => run((html) => grantTrustedHtml(path, html)),
    [run, path],
  );

  const handleReload = useCallback(() => {
    if (!token) return;
    run((html) => publishTrustedHtml(token, html));
  }, [run, token]);

  const handleRevoke = useCallback(() => {
    setError(null);
    setRan(null);
    void revokeTrustedHtml(path);
  }, [path]);

  const srcdoc = useMemo(
    () => (trusted ? null : buildSandboxedSrcdoc(content)),
    [content, trusted],
  );

  // An empty document used to return before the trust bar rendered, which took
  // the REVOKE control away while the grant stayed live — clearing the buffer
  // silently removed the only off switch. The placeholder now replaces the
  // frame, not the whole pane.
  const empty = !content.trim();

  return (
    <div className="html-preview">
      {/* WI-3.4's pending-sign-off notice, unchanged. It is a statement about
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
        onEnable={handleEnable}
        onRevoke={handleRevoke}
        onReload={handleReload}
      />
      {diagnostics.length > 0 && (
        <div className="html-preview__hint" role="status">
          {t("preview.errorAt", {
            line: diagnostics[0].line,
            column: diagnostics[0].column,
          })}
        </div>
      )}
      {empty ? (
        <div className="html-preview__empty-slot" data-testid="html-preview-empty" />
      ) : trusted && token ? (
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
        />
      ) : (
        <iframe
          // Empty sandbox: no scripts, no same-origin, no forms, no popups.
          sandbox=""
          title={t("preview.htmlIframeTitle")}
          srcDoc={srcdoc ?? ""}
          className="html-preview__iframe"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
