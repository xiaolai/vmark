/**
 * MergeBanner (WI-3.7) — a dismissible, pull-only notice that a git merge
 * landed (design-3.md D3.3). Nothing runs on its own: the notice comes
 * from the scan's `merge-completed` diagnostic, surfaced only when the
 * breakdown pulls. Dismissal is keyed by the merge SHA in localStorage,
 * so a NEW merge re-shows even after an older one was dismissed, but a
 * dismissed merge stays dismissed across reloads.
 *
 * @module components/BreakdownPanel/MergeBanner
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useBreakdownStore } from "@/stores/breakdownStore";

const DISMISS_KEY = "vmark-merge-dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function MergeBanner() {
  const notice = useBreakdownStore((s) => s.mergeNotice);
  const [dismissed, setDismissed] = useState(readDismissed);
  const { t } = useTranslation("breakdown");

  if (!notice || dismissed.has(notice.sha)) return null;

  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(notice.sha);
    setDismissed(next);
    try {
      // Cap the persisted set so it cannot grow without bound.
      const arr = Array.from(next).slice(-50);
      localStorage.setItem(DISMISS_KEY, JSON.stringify(arr));
    } catch {
      /* localStorage unavailable — session-only dismissal still works */
    }
  };

  return (
    <div className="breakdown-merge-banner" role="status">
      <span className="breakdown-merge-banner__text">{t("merge.banner")}</span>
      <button
        type="button"
        className="breakdown-merge-banner__dismiss"
        onClick={dismiss}
      >
        {t("merge.dismiss")}
      </button>
    </div>
  );
}
