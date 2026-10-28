/**
 * Concurrent pair diffs — the "Show both changes" control on a revision
 * edited in two windows, and the two labelled whole-document diffs it
 * opens: the saving window's own change, and the change against the
 * version before it in the timeline.
 *
 * Key decisions:
 *   - Deleted text is `<del>` (struck through), inserted text `<ins>`
 *     (underlined), so the difference never rests on colour alone.
 *   - Unchanged text is cut to context with "…" gaps, and a long part is
 *     clipped (`pairDiffView`); changes past the view's budget are counted,
 *     a diff the worker could not split says so, and a pair with no
 *     difference says that rather than showing an empty box.
 *   - A refused or failed read shows an error and no diff.
 *   - Each diff box scrolls on its own, so it takes keyboard focus
 *     (`tabIndex=0`) under its own name and shows the focus outline; the
 *     pair spans the whole history row, not its first column.
 *
 * @coordinates-with components/McpHistory/useConcurrentPair.ts — the load
 * @coordinates-with components/McpHistory/pairDiffView.ts — the segments
 * @module components/McpHistory/ConcurrentPairDiffs
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { DiffSegment } from "./pairDiffView";
import { useConcurrentPair, type PairDiff } from "./useConcurrentPair";
import "./concurrent-pair.css";

const GAP = "…";

function Segment({ segment }: { segment: DiffSegment }): React.ReactElement {
  if (segment.kind === "gap") return <span className="concurrent-pair__gap">{GAP}</span>;
  if (segment.kind === "same") return <span>{segment.text}</span>;
  const Tag = segment.kind === "delete" ? "del" : "ins";
  return (
    <>
      <Tag className={`concurrent-pair__${segment.kind}`}>{segment.text}</Tag>
      {segment.clipped && <span className="concurrent-pair__gap">{GAP}</span>}
    </>
  );
}

function PairSection({ title, diff }: { title: string; diff: PairDiff }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const titleId = useId();
  const { segments, hiddenChanges } = diff.view;
  return (
    <section className="concurrent-pair__section" aria-labelledby={titleId}>
      <div id={titleId} className="concurrent-pair__title">
        {title}
      </div>
      {segments.length === 0 ? (
        <p className="concurrent-pair__note">{t("review.pairNoDifference")}</p>
      ) : (
        // A scroll box: focusable so the keyboard can scroll it, named for its diff.
        <pre className="concurrent-pair__text" tabIndex={0} role="region" aria-label={t("review.pairDiffText", { title })}>
          {segments.map((segment, i) => (
            <Segment key={i} segment={segment} />
          ))}
        </pre>
      )}
      {diff.coarse && <p className="concurrent-pair__note">{t("review.pairCoarse")}</p>}
      {hiddenChanges > 0 && <p className="concurrent-pair__note">{t("review.pairHidden", { count: hiddenChanges })}</p>}
    </section>
  );
}

export function ConcurrentPairDiffs({ docKey, revision }: { docKey: string; revision: string }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const { open, load, toggle } = useConcurrentPair(docKey, revision);
  const bodyId = useId();
  return (
    <div className="concurrent-pair">
      <button
        type="button"
        className="vm-btn vm-btn--compact"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={toggle}
      >
        {t(open ? "review.hideBothChanges" : "review.showBothChanges")}
      </button>
      {open && (
        <div id={bodyId} className="concurrent-pair__body">
          {load.status === "loading" && (
            <p role="status" className="concurrent-pair__note">
              {t("review.pairLoading")}
            </p>
          )}
          {load.status === "failed" && (
            <p role="alert" className="concurrent-pair__error">
              {t("review.pairFailed")}
            </p>
          )}
          {load.status === "ready" && (
            <>
              <PairSection title={t("review.pairAgainstStart")} diff={load.fromStart} />
              <PairSection title={t("review.pairAgainstBefore")} diff={load.against} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
