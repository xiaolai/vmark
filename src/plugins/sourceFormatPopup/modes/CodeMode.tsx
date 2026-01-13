/**
 * Code Mode Component
 *
 * Renders language picker for code fences.
 */

import { useState, useRef, useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import type { RefObject } from "react";
import { icons, createIcon } from "@/utils/icons";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { setCodeFenceLanguage } from "../codeFenceActions";
import type { CodeFenceInfo } from "../codeFenceDetection";
import {
  QUICK_LANGUAGES,
  getQuickLabel,
  filterLanguages,
  getRecentLanguages,
} from "../languages";

interface CodeModeProps {
  editorView: EditorView;
  codeFenceInfo: CodeFenceInfo;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function CodeMode({
  editorView,
  codeFenceInfo,
  containerRef,
}: CodeModeProps) {
  const [languageSearch, setLanguageSearch] = useState("");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  const handleLanguageSelect = (language: string) => {
    setCodeFenceLanguage(editorView, codeFenceInfo, language);
    setLanguageDropdownOpen(false);
    setLanguageSearch("");
    const store = useSourceFormatStore.getState();
    store.clearOriginalCursor();
    store.closePopup();
    editorView.focus();
  };

  const recentLangs = getRecentLanguages();
  const quickLangs =
    recentLangs.length > 0
      ? recentLangs.slice(0, 5)
      : QUICK_LANGUAGES.map((l) => l.name);

  return (
    <>
      <div className="source-format-quick-langs">
        {quickLangs.map((name) => (
          <button
            key={name}
            type="button"
            className={`source-format-quick-btn ${codeFenceInfo.language === name ? "active" : ""}`}
            title={name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleLanguageSelect(name)}
          >
            {getQuickLabel(name)}
          </button>
        ))}
      </div>
      <div className="source-format-separator" />
      <div className="source-format-dropdown source-format-lang-dropdown">
        <button
          type="button"
          className={`source-format-btn source-format-dropdown-trigger ${languageDropdownOpen ? "active" : ""}`}
          title="Select language"
          aria-expanded={languageDropdownOpen}
          aria-haspopup="listbox"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          onKeyDown={(e) => {
            if (isImeKeyEvent(e)) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLanguageDropdownOpen(!languageDropdownOpen);
            } else if (e.key === "ArrowDown" && !languageDropdownOpen) {
              e.preventDefault();
              setLanguageDropdownOpen(true);
            }
          }}
        >
          <span className="source-format-lang-label">
            {codeFenceInfo.language || "plain"}
          </span>
          {createIcon(icons.chevronDown, 12)}
        </button>
        {languageDropdownOpen && (
          <div className="source-format-lang-menu" role="listbox">
            <div className="source-format-lang-search">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={languageSearch}
                onChange={(e) => setLanguageSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeKeyEvent(e)) return;
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setLanguageDropdownOpen(false);
                    const trigger = containerRef.current?.querySelector(
                      ".source-format-dropdown-trigger"
                    ) as HTMLElement;
                    trigger?.focus();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const filtered = filterLanguages(languageSearch);
                    if (filtered.length > 0) {
                      handleLanguageSelect(filtered[0].name);
                    }
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const firstItem = containerRef.current?.querySelector(
                      ".source-format-lang-item"
                    ) as HTMLElement;
                    firstItem?.focus();
                  }
                }}
              />
            </div>
            <div className="source-format-lang-section">
              <div className="source-format-lang-list" role="listbox">
                {filterLanguages(languageSearch).map(({ name }, index, arr) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={codeFenceInfo.language === name}
                    className={`source-format-lang-item ${codeFenceInfo.language === name ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleLanguageSelect(name)}
                    onKeyDown={(e) => {
                      if (isImeKeyEvent(e)) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        const items = containerRef.current?.querySelectorAll(
                          ".source-format-lang-item"
                        );
                        if (items && index < arr.length - 1) {
                          (items[index + 1] as HTMLElement)?.focus();
                        }
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        if (index === 0) {
                          searchInputRef.current?.focus();
                        } else {
                          const items = containerRef.current?.querySelectorAll(
                            ".source-format-lang-item"
                          );
                          if (items) {
                            (items[index - 1] as HTMLElement)?.focus();
                          }
                        }
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setLanguageDropdownOpen(false);
                        const trigger = containerRef.current?.querySelector(
                          ".source-format-dropdown-trigger"
                        ) as HTMLElement;
                        trigger?.focus();
                      } else if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleLanguageSelect(name);
                      }
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
