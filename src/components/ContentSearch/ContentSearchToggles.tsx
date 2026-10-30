/**
 * ContentSearchToggles
 *
 * Purpose: The case-sensitive / whole-word / regex / indexed-formats-only option
 * buttons and the trailing status text for ContentSearch. Split out to keep
 * the overlay component focused on state wiring. The `.md` toggle (store field
 * `markdownOnly`) limits the search to every format flagged
 * `contentSearchIndexed`, not markdown alone, so its label says so.
 *
 * @coordinates-with ContentSearch.tsx — parent overlay
 * @module components/ContentSearch/ContentSearchToggles
 */
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";

interface ContentSearchTogglesProps {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  markdownOnly: boolean;
  statusText: string;
  statusError: boolean;
}

export function ContentSearchToggles({
  caseSensitive,
  wholeWord,
  useRegex,
  markdownOnly,
  statusText,
  statusError,
}: ContentSearchTogglesProps) {
  const { t } = useTranslation("editor");
  return (
    <div className="content-search-toggles">
      <button
        className={`content-search-toggle${caseSensitive ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetCaseSensitive(!caseSensitive)}
        aria-pressed={caseSensitive}
        aria-label={t("contentSearch.caseSensitive")}
        title={t("contentSearch.caseSensitive")}
      >
        Aa
      </button>
      <button
        className={`content-search-toggle${wholeWord ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetWholeWord(!wholeWord)}
        aria-pressed={wholeWord}
        aria-label={t("contentSearch.wholeWord")}
        title={t("contentSearch.wholeWord")}
      >
        ab
      </button>
      <button
        className={`content-search-toggle${useRegex ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetUseRegex(!useRegex)}
        aria-pressed={useRegex}
        aria-label={t("contentSearch.regex")}
        title={t("contentSearch.regex")}
      >
        .*
      </button>
      <button
        className={`content-search-toggle${markdownOnly ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetMarkdownOnly(!markdownOnly)}
        aria-pressed={markdownOnly}
        aria-label={t("contentSearch.markdownOnly")}
        title={t("contentSearch.markdownOnly")}
      >
        .md
      </button>
      {statusText && (
        <span
          className={`content-search-status${statusError ? " content-search-status--error" : ""}`}
        >
          {statusText}
        </span>
      )}
    </div>
  );
}
