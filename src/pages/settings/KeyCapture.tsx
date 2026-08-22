/**
 * Key Capture Modal
 *
 * Modal overlay that captures keyboard input for shortcut customization.
 */

import { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatKeyForDisplay, type ShortcutDefinition } from "@/stores/settingsStore";
import { getShortcutLabel } from "@/stores/settingsShortcutLabels";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { canonicalizeChordString } from "@/utils/keybinding/canonicalChord";
import { Button } from "./components";
import { captureChord } from "@/pages/settings/captureChord";

interface KeyCaptureProps {
  shortcut: ShortcutDefinition;
  conflict: ShortcutDefinition | null;
  onCapture: (key: string) => void;
  onCancel: () => void;
}

export function KeyCapture({ shortcut, conflict, onCapture, onCancel }: KeyCaptureProps) {
  const { t } = useTranslation("settings");
  const [capturedKey, setCapturedKey] = useState<string | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels
    if (e.key === "Escape") {
      onCancel();
      return;
    }

    const keyStr = captureChord(e);
    if (keyStr === null) return; // lone modifier
    setCapturedKey(keyStr);
  }, [onCancel]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  // A captured chord that the runtime canonicalizer can't map (e.g. a shifted
  // symbol like `Mod-Shift->`, whose `>` has no physical code token) would be
  // stored but silently never fire — the binding drops from the resolver index
  // (WI-6.1). Validate against the SAME canonicalizer the router uses and refuse
  // to assign an unmappable chord instead of accepting a dead one.
  const unsupported = capturedKey !== null && canonicalizeChordString(capturedKey) === null;

  const handleConfirm = () => {
    if (capturedKey && !unsupported) {
      onCapture(capturedKey);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-color)] rounded-lg shadow-xl p-6 w-80 border border-[var(--border-color)]">
        <h3 className="text-lg font-semibold text-[var(--text-color)] mb-2">
          {t("shortcuts.capture.title")}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          {t("shortcuts.capture.prompt")} <strong>{getShortcutLabel(shortcut)}</strong>
        </p>

        {/* Key display */}
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 text-center mb-4 min-h-[60px] flex items-center justify-center">
          {capturedKey ? (
            <span className="text-xl font-mono text-[var(--text-color)]">
              {formatKeyForDisplay(capturedKey)}
            </span>
          ) : (
            <span className="text-sm text-[var(--text-tertiary)]">
              {t("shortcuts.capture.waiting")}
            </span>
          )}
        </div>

        {/* Unsupported-chord warning (won't canonicalize → would never fire) */}
        {unsupported && (
          <div className="bg-[var(--error-bg)] text-[var(--error-color)] border border-[var(--warning-border)]
                          rounded-lg p-3 mb-4 text-sm">
            {t("shortcuts.capture.unsupported")}
          </div>
        )}

        {/* Conflict warning */}
        {conflict && !unsupported && (
          <div className="bg-[var(--warning-bg)] text-[var(--warning-color)] border border-[var(--warning-border)]
                          rounded-lg p-3 mb-4 text-sm">
            <strong>{t("shortcuts.capture.conflict")}</strong>{" "}
            {t("shortcuts.capture.conflictUsedBy")}{" "}
            <strong>{getShortcutLabel(conflict)}</strong>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>
            {t("shortcuts.capture.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!capturedKey || unsupported}
          >
            {conflict ? t("shortcuts.capture.assignAnyway") : t("shortcuts.capture.assign")}
          </Button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] mt-4 text-center">
          {t("shortcuts.capture.pressEsc")}{" "}
          <kbd className="px-1 bg-[var(--bg-secondary)] rounded">Esc</kbd>{" "}
          {t("shortcuts.capture.toCancel")}
        </p>
      </div>
    </div>
  );
}
