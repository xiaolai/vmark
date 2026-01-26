/**
 * Shortcuts Settings
 *
 * UI for viewing and customizing keyboard shortcuts.
 */

import { useState, useRef } from "react";
import {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  formatKeyForDisplay,
  getShortcutsByCategory,
  type ShortcutDefinition,
  type ShortcutCategory,
} from "@/stores/shortcutsStore";
import { KeyCapture } from "./KeyCapture";
import { Button } from "./components";

export function ShortcutsSettings() {
  const [search, setSearch] = useState("");
  const [capturing, setCapturing] = useState<ShortcutDefinition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    getShortcut,
    setShortcut,
    resetShortcut,
    resetAllShortcuts,
    getConflict,
    exportConfig,
    importConfig,
    isCustomized,
  } = useShortcutsStore();

  // Filter shortcuts by search
  const filteredShortcuts = search.trim()
    ? DEFAULT_SHORTCUTS.filter(
        (s) =>
          s.label.toLowerCase().includes(search.toLowerCase()) ||
          s.category.toLowerCase().includes(search.toLowerCase()) ||
          (s.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : null;

  const handleCapture = (key: string) => {
    if (capturing) {
      setShortcut(capturing.id, key);
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
      const result = importConfig(reader.result as string);
      if (!result.success && result.errors) {
        alert(`Import errors:\n${result.errors.join("\n")}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const renderShortcutRow = (shortcut: ShortcutDefinition) => {
    const currentKey = getShortcut(shortcut.id);
    const customized = isCustomized(shortcut.id);

    return (
      <div
        key={shortcut.id}
        className={`flex items-center justify-between py-2 px-2 -mx-2
                   hover:bg-[var(--bg-secondary)]/50 rounded transition-colors`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text-primary)]">
            {shortcut.label}
          </div>
          {shortcut.description && (
            <div className="text-xs text-[var(--text-tertiary)] truncate">
              {shortcut.description}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          {/* Key display/edit button */}
          <button
            onClick={() => setCapturing(shortcut)}
            className={`px-3 py-1 rounded text-xs font-mono min-w-[90px] text-center
                       ${customized
                         ? "bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/30"
                         : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                       } hover:bg-[var(--bg-tertiary)] hover:ring-1 hover:ring-[var(--text-tertiary)]/30 transition-all`}
            title="Click to change"
          >
            {formatKeyForDisplay(currentKey)}
          </button>

          {/* Reset button (only show if customized) */}
          {customized && (
            <button
              onClick={() => resetShortcut(shortcut.id)}
              className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                         hover:bg-[var(--bg-secondary)] rounded transition-colors"
              title="Reset to default"
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
  };

  const renderCategorySection = (category: ShortcutCategory) => {
    const shortcuts = getShortcutsByCategory(category);
    if (shortcuts.length === 0) return null;

    return (
      <div key={category} className="mb-6">
        {/* Category heading */}
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 pb-1
                       border-b border-[var(--bg-tertiary)]">
          {CATEGORY_LABELS[category]}
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
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Click a shortcut to change it.
      </p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-0 py-1 text-sm bg-transparent text-[var(--text-primary)]
                       border-0 border-b border-[var(--border-color)]
                       placeholder:text-[var(--text-tertiary)]
                       focus:border-[var(--primary-color)]"
          />
        </div>

        {/* Import/Export */}
        <Button onClick={handleExport}>
          Export
        </Button>
        <Button onClick={() => fileInputRef.current?.click()}>
          Import
        </Button>
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
            if (confirm("Reset all shortcuts to defaults?")) {
              resetAllShortcuts();
            }
          }}
        >
          Reset All
        </Button>
      </div>

      {/* Shortcuts list */}
      <div className="max-h-[60vh] overflow-y-auto pr-2">
        {filteredShortcuts ? (
          // Search results (flat list)
          <div>
            <div className="text-xs text-[var(--text-tertiary)] mb-3">
              {filteredShortcuts.length} result{filteredShortcuts.length !== 1 ? "s" : ""}
            </div>
            <div className="space-y-0.5">
              {filteredShortcuts.map(renderShortcutRow)}
            </div>
            {filteredShortcuts.length === 0 && (
              <div className="text-sm text-[var(--text-tertiary)] py-8 text-center">
                No shortcuts found
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
          conflict={getConflict(getShortcut(capturing.id), capturing.id)}
          onCapture={handleCapture}
          onCancel={() => setCapturing(null)}
        />
      )}
    </div>
  );
}
