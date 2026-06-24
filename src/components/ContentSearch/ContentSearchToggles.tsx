/**
 * ContentSearchToggles
 *
 * Purpose: The case-sensitive / whole-word / regex / markdown-only option
 * buttons and the trailing status text for ContentSearch. Split out to keep
 * the overlay component focused on state wiring. Behavior preserved verbatim.
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
        aria-label={t("contentSearch.caseSensitive", "Case Sensitive")}
        title={t("contentSearch.caseSensitive", "Case Sensitive")}
      >
        Aa
      </button>
      <button
        className={`content-search-toggle${wholeWord ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetWholeWord(!wholeWord)}
        aria-pressed={wholeWord}
        aria-label={t("contentSearch.wholeWord", "Whole Word")}
        title={t("contentSearch.wholeWord", "Whole Word")}
      >
        ab
      </button>
      <button
        className={`content-search-toggle${useRegex ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetUseRegex(!useRegex)}
        aria-pressed={useRegex}
        aria-label={t("contentSearch.regex", "Regular Expression")}
        title={t("contentSearch.regex", "Regular Expression")}
      >
        .*
      </button>
      <button
        className={`content-search-toggle${markdownOnly ? " content-search-toggle--active" : ""}`}
        onClick={() => useUIStore.getState().contentSearchSetMarkdownOnly(!markdownOnly)}
        aria-pressed={markdownOnly}
        aria-label={t("contentSearch.markdownOnly", "Markdown Files Only")}
        title={t("contentSearch.markdownOnly", "Markdown Files Only")}
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
