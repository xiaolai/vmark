/**
 * ViewModeToggle — segmented Source / Split / Preview control.
 *
 * Purpose: the in-surface mode picker for split-pane / viewer formats that
 * declare a preview. Rendered by SplitPaneEditor only when a preview exists;
 * sets the per-tab `Tab.viewMode`. A `role="radiogroup"` with roving tabindex
 * (arrow / Home / End) — one of three mutually-exclusive view states, so radios
 * fit better than tabs. See dev-docs/plans/20260703-split-pane-view-modes.md.
 *
 * @module components/Editor/SplitPaneEditor/ViewModeToggle
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SplitViewMode } from "@/lib/formats/types";
import "./view-mode-toggle.css";

const MODES: readonly SplitViewMode[] = ["source", "split", "preview"];

export interface ViewModeToggleProps {
  mode: SplitViewMode;
  onChange: (mode: SplitViewMode) => void;
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  const { t } = useTranslation("editor");
  const btnRefs = useRef<Partial<Record<SplitViewMode, HTMLButtonElement | null>>>(
    {},
  );

  // Move selection AND DOM focus to the target (roving tabindex): keyboard
  // users must land on the newly-checked radio, not stay on the old one.
  function selectMode(next: SplitViewMode) {
    onChange(next);
    btnRefs.current[next]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = MODES.indexOf(mode);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectMode(MODES[(idx + 1) % MODES.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectMode(MODES[(idx - 1 + MODES.length) % MODES.length]);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectMode(MODES[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      selectMode(MODES[MODES.length - 1]);
    }
  }

  return (
    <div
      className="view-mode-toggle"
      role="radiogroup"
      aria-label={t("splitPane.viewMode.label")}
      onKeyDown={handleKeyDown}
    >
      {MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            ref={(el) => {
              btnRefs.current[m] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: only the active radio is in the tab order.
            tabIndex={active ? 0 : -1}
            className={
              active
                ? "view-mode-toggle__btn view-mode-toggle__btn--active"
                : "view-mode-toggle__btn"
            }
            onClick={() => onChange(m)}
          >
            {t(`splitPane.viewMode.${m}`)}
          </button>
        );
      })}
    </div>
  );
}
