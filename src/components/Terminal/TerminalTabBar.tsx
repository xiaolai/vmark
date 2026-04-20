/**
 * TerminalTabBar
 *
 * Purpose: Tab bar for the terminal panel. Renders vertically on the right
 * side (when panel is at the bottom) or horizontally at the bottom (when
 * panel is on the right). Shows numbered buttons for switching between
 * terminal sessions, plus create/close/restart controls.
 *
 * Key decisions:
 *   - Maximum 5 sessions enforced by disabling the "+" button.
 *   - getTabDisplay extracts the number from "Terminal N" labels for
 *     compact display; custom names show first character.
 *   - Dead sessions (process exited) get a visual indicator via CSS class.
 *   - Uses getState() pattern for session creation to avoid stale closures.
 *
 * @coordinates-with TerminalPanel.tsx — provides onClose and onRestart callbacks
 * @coordinates-with terminalSessionStore — reads sessions and activeSessionId
 * @module components/Terminal/TerminalTabBar
 */
import { useCallback } from "react";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";
import "./TerminalTabBar.css";

interface TerminalTabBarProps {
  onClose: () => void;
  onRestart: () => void;
  /** "vertical" = right-side column (default, for bottom panel), "horizontal" = bottom row (for right panel) */
  orientation?: "vertical" | "horizontal";
}

/** Extract display number from "Terminal N" labels, or first char for custom names. */
function getTabDisplay(label: string): string {
  const m = label.match(/^Terminal (\d+)$/);
  return m ? m[1] : (label.charAt(0).toUpperCase() || "?");
}

/** Renders numbered buttons for switching between terminal sessions plus create/close/restart controls. */
export function TerminalTabBar({ onClose, onRestart, orientation = "vertical" }: TerminalTabBarProps) {
  const { t } = useTranslation("statusbar");
  const sessions = useTerminalSessionStore((s) => s.sessions);
  const activeId = useTerminalSessionStore((s) => s.activeSessionId);

  const handleCreate = useCallback(() => {
    useTerminalSessionStore.getState().createSession();
  }, []);

  const handleSwitch = useCallback((id: string) => {
    useTerminalSessionStore.getState().setActiveSession(id);
  }, []);

  const isMaxed = sessions.length >= 5;

  return (
    <div className={`terminal-tab-bar ${orientation === "horizontal" ? "terminal-tab-bar--horizontal" : ""}`}>
      <div className="terminal-tab-bar-tabs">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`terminal-tab ${s.id === activeId ? "terminal-tab-active" : ""} ${!s.isAlive ? "terminal-tab-dead" : ""}`}
            onClick={() => handleSwitch(s.id)}
            title={s.label}
            aria-label={s.label}
          >
            {getTabDisplay(s.label)}
          </button>
        ))}

        <button
          className="terminal-tab-bar-btn"
          onClick={handleCreate}
          disabled={isMaxed}
          title={isMaxed ? t("terminal.maxSessions") : t("terminal.newSession")}
          aria-label={isMaxed ? t("terminal.maxSessions") : t("terminal.newSession")}
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="terminal-tab-bar-actions">
        <button className="terminal-tab-bar-btn" onClick={onClose} title={t("terminal.closeSession")} aria-label={t("terminal.closeSession")}>
          <Trash2 size={12} />
        </button>
        <button className="terminal-tab-bar-btn" onClick={onRestart} title={t("terminal.restartSession")} aria-label={t("terminal.restartSession")}>
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  );
}
