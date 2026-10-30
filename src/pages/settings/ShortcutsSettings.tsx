/**
 * Shortcuts Settings
 *
 * UI for viewing and customizing keyboard shortcuts.
 *
 * Key decisions:
 *   - Capturing a chord another shortcut owns reassigns it (the owner becomes
 *     unassigned); the capture modal can also unassign the row.
 *   - A native-menu refusal of the new map is toasted, not only logged.
 *
 * @module pages/settings/ShortcutsSettings
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  CATEGORY_ORDER,
  formatKeyForDisplay,
  onMenuShortcutSyncFailure,
  type ShortcutDefinition,
  type ShortcutCategory,
} from "@/stores/settingsStore";
import {
  getCategoryLabel,
  getShortcutLabel,
  getShortcutDescription,
} from "@/stores/settingsShortcutLabels";
import { commandErrorMessage } from "@/services/commands/commandError";
import { KeyCapture } from "./KeyCapture";
import { ShortcutRow } from "./ShortcutRow";
import { describeShortcutImportError } from "./shortcutImportErrors";
import { Button, SearchInput } from "./components";
import { confirmAction } from "@/services/dialogs/confirmAction";
import i18n from "@/i18n";
import { appError } from "@/utils/debug";
import { imeToast as toast } from "@/services/ime/imeToast";

export function ShortcutsSettings() {
  const { t } = useTranslation("settings");
  const [search, setSearch] = useState("");
  const [capturing, setCapturing] = useState<ShortcutDefinition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to customBindings so component re-renders when shortcuts change
  useShortcutsStore((s) => s.customBindings);

  // Access action methods via getState() — avoids subscribing to entire store
  const {
    getShortcut,
    setShortcut,
    reassignShortcut,
    resetShortcut,
    resetAllShortcuts,
    getConflict,
    exportConfig,
    importConfig,
    isCustomized,
  } = useShortcutsStore.getState();

  // Every definition stays listed, including the ones with no effective key.
  // An unbound shortcut renders as "Unassigned" and is bound from here like any
  // other. The pane used to filter those rows out, so a definition
  // that ships unbound (or one the user had cleared) could never be given a key
  // again without a JSON import.
  const unassignedLabel = t("shortcuts.unassigned");

  // Filter shortcuts by search (label, translated label, category, description, key format, display format)
  const filteredShortcuts = search.trim()
    ? DEFAULT_SHORTCUTS.filter((s) => {
        const q = search.trim().toLowerCase();
        const effectiveKey = getShortcut(s.id);
        const displayKey = (
          effectiveKey ? formatKeyForDisplay(effectiveKey) : unassignedLabel
        ).toLowerCase();
        const translatedLabel = getShortcutLabel(s).toLowerCase();
        return (
          s.label.toLowerCase().includes(q) ||
          translatedLabel.includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (getShortcutDescription(s)?.toLowerCase().includes(q) ?? false) ||
          effectiveKey.toLowerCase().includes(q) ||
          displayKey.includes(q)
        );
      })
    : null;

  // A refused native-menu update would otherwise leave a rebinding that looks
  // applied but that the menu bar never took.
  useEffect(
    () =>
      onMenuShortcutSyncFailure((e) => {
        toast.error(t("shortcuts.menuSyncFailed"), { description: commandErrorMessage(e) });
      }),
    [t],
  );

  // A chord another shortcut owns MOVES to this one: two shortcuts sharing a
  // chord means only one of them ever fires.
  const handleCapture = (key: string) => {
    if (capturing) {
      reassignShortcut(capturing.id, key);
      setCapturing(null);
    }
  };

  const handleClear = () => {
    if (capturing) {
      setShortcut(capturing.id, "");
      setCapturing(null);
    }
  };

  const handleExport = () => {
    const config = exportConfig();
    const blob = new Blob([config], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vmark-shortcuts.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      // `importConfig` is ATOMIC (audit 20260907, #422): a file with any bad
      // entry applies NOTHING, so this message can say so — it used to report
      // errors after the valid entries had already replaced the user's map.
      const result = importConfig(reader.result as string);
      if (!result.success) {
        toast.error(t("shortcuts.importFailed"), {
          description: result.errors.map(describeShortcutImportError).join("\n"),
          pin: true,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const renderShortcutRow = (shortcut: ShortcutDefinition) => (
    <ShortcutRow
      key={shortcut.id}
      shortcut={shortcut}
      currentKey={getShortcut(shortcut.id)}
      customized={isCustomized(shortcut.id)}
      onEdit={() => setCapturing(shortcut)}
      onReset={() => resetShortcut(shortcut.id)}
    />
  );

  const renderCategorySection = (category: ShortcutCategory) => {
    const shortcuts = DEFAULT_SHORTCUTS.filter((s) => s.category === category);
    if (shortcuts.length === 0) return null;

    return (
      <div key={category} className="mb-6">
        {/* Category heading */}
        <h3 className="text-sm font-semibold text-[var(--text-color)] mb-2 pb-1
                       border-b border-[var(--bg-tertiary)]">
          {getCategoryLabel(category)}
        </h3>
        {/* Indented shortcut list */}
        <div className="space-y-0.5">
          {shortcuts.map(renderShortcutRow)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <p className="text-xs text-[var(--text-secondary)] mb-4">
        {t("shortcuts.hint")}
      </p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <SearchInput
            type="search"
            placeholder={t("shortcuts.searchPlaceholder")}
            value={search}
            onChange={setSearch}
          />
        </div>

        {/* Import/Export */}
        <Button onClick={handleExport}>
          {t("shortcuts.export")}
        </Button>
        <Button onClick={() => fileInputRef.current?.click()}>
          {t("shortcuts.import")}
        </Button>
        {/* ui-ok(focus): display:none file input, opened programmatically by
            the Import button — never keyboard-reachable. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />

        {/* Reset All */}
        <Button
          variant="danger"
          onClick={() => {
            void (async () => {
              if (
                await confirmAction({
                  title: i18n.t("dialog:resetShortcuts.title"),
                  message: t("shortcuts.resetAllConfirm"),
                  actionLabel: i18n.t("dialog:action.resetShortcuts"),
                  kind: "warning",
                })
              ) {
                resetAllShortcuts();
              }
            })().catch((e) => appError("Reset-shortcuts confirm failed:", e));
          }}
        >
          {t("shortcuts.resetAll")}
        </Button>
      </div>

      {/* Shortcuts list */}
      <div className="max-h-[60vh] overflow-y-auto pr-2">
        {filteredShortcuts ? (
          // Search results (flat list)
          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-3">
              {t(
                filteredShortcuts.length === 1 ? "shortcuts.resultCount_one" : "shortcuts.resultCount_other",
                { count: filteredShortcuts.length }
              )}
            </div>
            <div className="space-y-0.5">
              {filteredShortcuts.map(renderShortcutRow)}
            </div>
            {filteredShortcuts.length === 0 && (
              <div className="text-sm text-[var(--text-secondary)] py-8 text-center">
                {t("shortcuts.noResults")}
              </div>
            )}
          </div>
        ) : (
          // Grouped by category with headings
          CATEGORY_ORDER.map((category) => renderCategorySection(category))
        )}
      </div>

      {/* Key capture modal */}
      {capturing && (
        <KeyCapture
          shortcut={capturing}
          getConflict={(key) => getConflict(key, capturing.id)}
          currentKey={getShortcut(capturing.id)}
          onCapture={handleCapture}
          onClear={handleClear}
          onCancel={() => setCapturing(null)}
        />
      )}
    </div>
  );
}
