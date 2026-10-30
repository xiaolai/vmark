/**
 * Shortcut row — one line of the Shortcuts pane: the shortcut's label and
 * description, its chord button (opens the capture modal) and, once
 * customized, a reset-to-default button.
 *
 * An unbound shortcut renders as "Unassigned" and is bound from its button
 * like any other row.
 *
 * @coordinates-with pages/settings/ShortcutsSettings.tsx — renders one per definition
 * @module pages/settings/ShortcutRow
 */

import { useTranslation } from "react-i18next";
import { formatKeyForDisplay, type ShortcutDefinition } from "@/stores/settingsStore";
import { getShortcutLabel, getShortcutDescription } from "@/stores/settingsShortcutLabels";

interface ShortcutRowProps {
  shortcut: ShortcutDefinition;
  /** Effective chord; empty when unassigned. */
  currentKey: string;
  customized: boolean;
  onEdit: () => void;
  onReset: () => void;
}

export function ShortcutRow({ shortcut, currentKey, customized, onEdit, onReset }: ShortcutRowProps) {
  const { t } = useTranslation("settings");
  const description = getShortcutDescription(shortcut);

  return (
    <div
      className={`flex items-center justify-between py-2 px-2 -mx-2
                 hover:bg-[var(--bg-secondary)]/50 rounded-sm transition-colors`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text-color)]">
          {getShortcutLabel(shortcut)}
        </div>
        {description && (
          <div className="text-xs text-[var(--text-secondary)] truncate">
            {description}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-4">
        {/* Key display/edit button */}
        <button
          onClick={onEdit}
          className={`px-3 py-1 rounded-sm text-xs font-mono min-w-[90px] text-center
                     ${customized
                       ? "bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/30"
                       : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                     } hover:bg-[var(--bg-tertiary)] hover:ring-1 hover:ring-[var(--text-tertiary)]/30 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2`}
          title={t("shortcuts.clickToChange")}
        >
          {currentKey ? (
            formatKeyForDisplay(currentKey)
          ) : (
            <span className="italic">{t("shortcuts.unassigned")}</span>
          )}
        </button>

        {/* Reset button (only show if customized) */}
        {customized && (
          <button
            onClick={onReset}
            className="vm-icon-btn vm-icon-btn--sm"
            title={t("shortcuts.resetToDefault")}
            aria-label={t("shortcuts.resetToDefault")}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
