/**
 * Terminal Bar Component
 *
 * Bottom bar with split and close buttons for single terminal view.
 * When split (2 panes), each pane has its own close button overlay.
 */

import { Columns2, Rows2, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import "./TerminalTabs.css";

interface TerminalTabsProps {
  onSplit: () => void;
  onClose?: () => void;
  isSplit: boolean;
  canSplit: boolean;
}

export function TerminalTabs({ onSplit, onClose, isSplit, canSplit }: TerminalTabsProps) {
  const position = useSettingsStore((state) => state.terminal.position);

  // Split direction based on position: bottom=horizontal (side by side), right=vertical (top/bottom)
  const SplitIcon = position === "bottom" ? Columns2 : Rows2;
  const splitTitle = position === "bottom" ? "Split horizontal" : "Split vertical";

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list" />
      <div className="terminal-tabs-actions">
        {/* Split button - hidden when already split */}
        {!isSplit && (
          <button
            className="terminal-tab-action"
            onClick={onSplit}
            disabled={!canSplit}
            title={splitTitle}
          >
            <SplitIcon className="w-4 h-4" />
          </button>
        )}
        {/* Close button - only for single terminal (split panes have their own) */}
        {!isSplit && onClose && (
          <button
            className="terminal-tab-action"
            onClick={onClose}
            title="Close terminal"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
