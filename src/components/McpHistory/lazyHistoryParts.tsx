/**
 * Lazy history parts
 *
 * Purpose: the review panel, the comments panel and the two-windows pair
 *   view load on first render instead of at startup. The history button
 *   lives in the status bar, which is part of the cold-start bundle, and no
 *   part is needed until the popover opens.
 *
 * Key decisions:
 *   - Each part sits behind `RetryableLazy`, so a chunk that fails to load
 *     shows a local message with a retry that really retries, instead of a
 *     cached rejection reaching an outer boundary.
 *   - `load` is a prop with the real import as its default, so the failure
 *     path is tested through the component's contract, not a mocked module.
 *   - Only type imports reach the parts statically; a value import would
 *     pull them back into the cold-start bundle.
 *
 * @coordinates-with components/RetryableLazy.tsx — the fresh-lazy-per-attempt mount
 * @coordinates-with components/ReviewPanel/ReviewPanel.tsx — the lazily loaded panel
 * @coordinates-with components/Comments/CommentsPanel.tsx — the lazily loaded comments panel
 * @coordinates-with components/McpHistory/ConcurrentPairDiffs.tsx — the lazily loaded pair view
 * @module components/McpHistory/lazyHistoryParts
 */
import type { ComponentProps, ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { RetryableLazy } from "@/components/RetryableLazy";
import type { ReviewPanel } from "@/components/ReviewPanel/ReviewPanel";
import type { CommentsPanel } from "@/components/Comments/CommentsPanel";
import type { ConcurrentPairDiffs } from "./ConcurrentPairDiffs";

type ReviewPanelProps = ComponentProps<typeof ReviewPanel>;
type CommentsPanelProps = ComponentProps<typeof CommentsPanel>;
type PairProps = ComponentProps<typeof ConcurrentPairDiffs>;
type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

const loadReviewPanel: Loader<ReviewPanelProps> = () =>
  import("@/components/ReviewPanel/ReviewPanel").then((m) => ({ default: m.ReviewPanel }));

const loadCommentsPanel: Loader<CommentsPanelProps> = () =>
  import("@/components/Comments/CommentsPanel").then((m) => ({ default: m.CommentsPanel }));

const loadPairDiffs: Loader<PairProps> = () =>
  import("./ConcurrentPairDiffs").then((m) => ({ default: m.ConcurrentPairDiffs }));

function HistoryPartError({ onRetry }: { onRetry: () => void }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  return (
    <p role="alert" className="mcp-history-part-error">
      {t("review.loadFailed")}{" "}
      <button type="button" className="vm-btn vm-btn--compact" onClick={onRetry}>
        {t("review.retryLoad")}
      </button>
    </p>
  );
}

/** A part behind `RetryableLazy`, with `load` overridable for tests. */
function lazyPart<P extends object>(feature: string, defaultLoad: Loader<P>) {
  return function LazyPart({ load = defaultLoad, ...props }: P & { load?: Loader<P> }): React.ReactElement {
    return <RetryableLazy feature={feature} load={load} componentProps={props as P} renderError={(retry) => <HistoryPartError onRetry={retry} />} />;
  };
}

export const LazyReviewPanel = lazyPart("Review panel", loadReviewPanel);
export const LazyCommentsPanel = lazyPart("Comments panel", loadCommentsPanel);
export const LazyConcurrentPairDiffs = lazyPart("Two-windows pair view", loadPairDiffs);
