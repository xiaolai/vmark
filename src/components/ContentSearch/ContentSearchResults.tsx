/**
 * ContentSearchResults
 *
 * Purpose: Renders the grouped file/match list for ContentSearch. Split out
 * of ContentSearch so the overlay component owns only state wiring and the
 * list owns its (flat-index) rendering. Behavior preserved verbatim.
 *
 * @coordinates-with ContentSearch.tsx — parent overlay
 * @coordinates-with uiStore — selectedIndex hover updates
 * @module components/ContentSearch/ContentSearchResults
 */
import { useUIStore, type FileSearchResult, type LineMatch } from "@/stores/uiStore";
import { SpotlightFileIcon } from "@/components/spotlight/spotlightDialog";
import { renderHighlightedLine } from "./contentSearchUtils";

function FileIcon() {
  return <SpotlightFileIcon className="content-search-file-icon" />;
}

interface ContentSearchResultsProps {
  results: FileSearchResult[];
  selectedIndex: number;
  onSelectMatch: (file: FileSearchResult, match: LineMatch) => void;
}

export function ContentSearchResults({
  results,
  selectedIndex,
  onSelectMatch,
}: ContentSearchResultsProps) {
  let flatIdx = 0;
  const rendered: React.ReactNode[] = [];

  for (let fi = 0; fi < results.length; fi++) {
    const file = results[fi];
    rendered.push(
      <div key={`file-${fi}`} className="content-search-file" role="presentation">
        <FileIcon />
        <span>{file.relativePath}</span>
        <span className="content-search-file-count">{file.matches.length}</span>
      </div>,
    );

    for (let mi = 0; mi < file.matches.length; mi++) {
      const match = file.matches[mi];
      const currentFlatIdx = flatIdx++;
      const isSelected = currentFlatIdx === selectedIndex;

      rendered.push(
        <div
          key={`match-${fi}-${mi}`}
          className={`content-search-match${isSelected ? " content-search-match--selected" : ""}`}
          data-match-index={currentFlatIdx}
          role="option"
          aria-selected={isSelected}
          onClick={() => onSelectMatch(file, match)}
          onMouseEnter={() =>
            useUIStore.setState((s) => ({
              contentSearch: { ...s.contentSearch, selectedIndex: currentFlatIdx },
            }))
          }
        >
          <span className="content-search-line-num">{match.lineNumber}</span>
          <span className="content-search-line-text">
            {renderHighlightedLine(match.lineContent, match.matchRanges)}
          </span>
        </div>,
      );
    }
  }

  return <>{rendered}</>;
}
