/**
 * Key Capture Modal
 *
 * Modal overlay that captures keyboard input for shortcut customization.
 */

import { useEffect, useCallback, useState } from "react";
import { formatKeyForDisplay, type ShortcutDefinition } from "@/stores/shortcutsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";

interface KeyCaptureProps {
  shortcut: ShortcutDefinition;
  conflict: ShortcutDefinition | null;
  onCapture: (key: string) => void;
  onCancel: () => void;
}

export function KeyCapture({ shortcut, conflict, onCapture, onCancel }: KeyCaptureProps) {
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
      <div className="bg-[var(--bg-primary)] rounded-lg shadow-xl p-6 w-80 border border-[var(--border-primary)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          Set Shortcut
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          Press a key combination for <strong>{shortcut.label}</strong>
        </p>

        {/* Key display */}
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 text-center mb-4 min-h-[60px] flex items-center justify-center">
          {capturedKey ? (
            <span className="text-xl font-mono text-[var(--text-primary)]">
              {formatKeyForDisplay(capturedKey)}
            </span>
          ) : (
            <span className="text-sm text-[var(--text-tertiary)]">
              Waiting for input...
            </span>
          )}
        </div>

        {/* Conflict warning */}
        {conflict && (
          <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200
                          rounded-lg p-3 mb-4 text-sm">
            <strong>Conflict:</strong> This key is already used by{" "}
            <strong>{conflict.label}</strong>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!capturedKey}
            className="px-4 py-2 text-sm bg-[var(--accent-primary)] text-white rounded
                       disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
          >
            {conflict ? "Assign Anyway" : "Assign"}
          </button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] mt-4 text-center">
          Press <kbd className="px-1 bg-[var(--bg-secondary)] rounded">Esc</kbd> to cancel
        </p>
      </div>
    </div>
  );
}
