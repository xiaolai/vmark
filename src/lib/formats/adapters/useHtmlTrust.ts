/**
 * The trust lifecycle behind `HtmlPreview` — what the frame is running, whether
 * that is stale, and the guarded actions that change it.
 *
 * Extracted from the component, which was carrying this alongside the sanitized
 * srcdoc, the empty-document placeholder and two frame renderers. None of what
 * follows is about rendering, and every line of it was learned the hard way.
 *
 * @coordinates-with HtmlPreview.tsx — sole consumer
 * @module lib/formats/adapters/useHtmlTrust
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commandErrorMessage } from "@/services/commands/commandError";
import {
  grantTrustedHtml,
  publishTrustedHtml,
  revokeTrustedHtml,
} from "@/services/trustedHtml/trustedHtmlBridge";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";

export interface HtmlTrustState {
  /** The live grant, or null. The frame URL is built from it. */
  token: string | null;
  /** True while a grant exists for this path — i.e. `token !== null`. */
  trusted: boolean;
  /** True when the frame may not be running what the file now says. */
  stale: boolean;
  /** Last action's failure, already localized. */
  error: string | null;
  /** Bumped on Reload so the frame refetches the same token. */
  runCount: number;
  onEnable: () => void;
  onReload: () => void;
  onRevoke: () => void;
}

export function useHtmlTrust(path: string | null, liveContent: string): HtmlTrustState {
  const { t } = useTranslation("editor");
  const token = useHtmlTrustStore((s) => (path ? (s.grants[path] ?? null) : null));

  /** The content the trusted frame is currently running. */
  const [ran, setRan] = useState<string | null>(null);
  /** Bumped on Reload so the frame refetches the same token. */
  const [runCount, setRunCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A pane can render a different document without remounting, and `ran`
  // describes the PREVIOUS one — so it must be cleared, or the new file would
  // be judged against content that belongs to another document entirely.
  // Clearing means "unknown", which now reads as possibly-stale rather than as
  // current (see the `stale` note below). Adjusted during render rather than in
  // an effect, same as HtmlTrustBar's confirmation reset.
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
  //
  // UNKNOWN IS NOT CURRENT (issue #1328). `ran === null` means this pane does
  // not know what the frame is running — after a remount, or after switching to
  // a file trusted earlier in the session. It is NOT evidence that the frame is
  // up to date: the grant lives in a module-level store keyed by path, so it
  // outlives the component, and the frame reloads and re-executes whatever that
  // token still holds. The guard used to be `ran !== null && ran !== liveContent`,
  // which rendered that uncertainty as a clean bill of health — a user who
  // closed and reopened a trusted tab saw superseded output with no stale
  // marker and no reason to press Reload. Comparing `null` against a string is
  // the whole fix: unknown compares unequal, so it reports.
  //
  // Reporting is ALL this does. Nothing here publishes or re-runs; making the
  // preview match the file stays an explicit user action (Reload), so content
  // that changed since the user authorized it never executes on its own.
  const stale = trusted && ran !== liveContent;

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
  // Which document this pane is showing RIGHT NOW, readable from inside an
  // async completion. A pane renders a different file without remounting, so
  // `path` captured in a closure describes where the operation STARTED, and
  // this ref describes where it landed.
  const currentPath = useRef(path);
  // Synced in an effect, not during render: writing a ref while rendering is
  // what `react-hooks/refs` forbids, and effects run at commit — long before
  // any awaited IPC round trip can settle.
  useEffect(() => {
    currentPath.current = path;
  }, [path]);
  const run = useCallback(
    (operation: (html: string) => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      const html = liveContent;
      // The document this operation belongs to. Its completion may only write
      // state while the pane is still showing it: `setRunCount` feeds the
      // trusted frame's `?run=` parameter, so a completion belonging to a file
      // the pane has already left forced a DIFFERENT trusted document to
      // reload and re-execute — an execution nobody asked for, which is the
      // one thing this feature promises never to do (audit finding #32).
      const startedOn = path;
      void (async () => {
        try {
          await operation(html);
          if (currentPath.current !== startedOn) return;
          setRan(html);
          setRunCount((n) => n + 1);
        } catch (e) {
          // Same scope rule: a failure belongs to the document that caused it.
          if (currentPath.current === startedOn) {
            setError(t("preview.htmlTrustFailed", { error: commandErrorMessage(e) }));
          }
        } finally {
          busy.current = false;
        }
      })();
    },
    [liveContent, path, t],
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

  return { token, trusted, stale, error, runCount, onEnable: handleEnable, onReload: handleReload, onRevoke: handleRevoke };
}
