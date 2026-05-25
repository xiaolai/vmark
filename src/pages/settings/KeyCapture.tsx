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
import { Button } from "./components";

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

    // Ignore lone modifier keys
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
      return;
    }

    // Build key string in ProseMirror format
    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push("Mod");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    // Handle special keys
    let key = e.key;
    if (key === " ") key = "Space";
    else if (key === "ArrowLeft") key = "Left";
    else if (key === "ArrowRight") key = "Right";
    else if (key === "ArrowUp") key = "Up";
    else if (key === "ArrowDown") key = "Down";
    else if (key.length === 1) key = key.toLowerCase();

    parts.push(key);
    const keyStr = parts.join("-");
    setCapturedKey(keyStr);
  }, [onCancel]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const handleConfirm = () => {
    if (capturedKey) {
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

        {/* Conflict warning */}
        {conflict && (
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
            disabled={!capturedKey}
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
