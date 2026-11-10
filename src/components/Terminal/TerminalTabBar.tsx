/**
 * TerminalTabBar
 *
 * Purpose: Tab bar for the terminal panel. Renders vertically for a
 * top/bottom panel (the panel's vertical axis) or horizontally for a
 * left/right panel. Shows numbered buttons for switching between
 * terminal sessions, plus create/close/restart and a swap control that flips
 * the panel to the opposite side of its current axis. Double-clicking a tab
 * renames it inline (TerminalTabRename).
 *
 * Key decisions:
 *   - Maximum 5 sessions enforced by disabling the "+" button.
 *   - getTabDisplay uses the session's stable `ordinal` for the compact glyph
 *     while the tab still has its default name, and the first GRAPHEME of the
 *     name otherwise. It does not parse the label: that string is display
 *     text, and scraping "Terminal N" out of it broke the moment the label
 *     was translated or renamed.
 *   - The tab shows the program-reported title (OSC 0/2 via onTitleChange)
 *     unless the user manually renamed the session — user intent wins (G4).
 *   - Double-click a tab to rename it. Until then `isUserRenamed`
 *     had no writer outside tests, so the "user intent wins" branch above was
 *     unreachable in production (T5).
 *   - Dead sessions (process exited) get a visual indicator via CSS class.
 *   - Uses getState() pattern for session creation to avoid stale closures.
 *   - With transcript rendering on, the actions group also holds the
 *     rendered-transcript toggle: a chart icon, pressed (accent wash) while the
 *     transcript is open, with `aria-controls` naming the region.
 *   - Every action button carries a stable `data-terminal-action`
 *     (`new`/`close`/`restart`/`swap`, and `transcript` when enabled). The E2E terminal journeys drive these to
 *     create and dispose their OWN session, so the values are an automation
 *     CONTRACT, not decoration: selecting by DOM order is fragile and by
 *     aria-label breaks under any non-English locale. Renaming or dropping one
 *     breaks E2E, not just a unit test — TerminalTabBar.test.tsx pins all four.
 *
 * @coordinates-with TerminalPanel.tsx — provides onClose and onRestart callbacks
 * @coordinates-with stores/terminalStore/sessionActions.ts — reads sessions and activeSessionId
 * @coordinates-with e2e/lib/terminal.mjs — drives the data-terminal-action hooks
 * @module components/Terminal/TerminalTabBar
 */
import { useCallback, useState } from "react";
import { Plus, Trash2, RotateCcw, ArrowLeftRight, ArrowUpDown, ChartColumn } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";
import { MAX_TERMINAL_SESSIONS, useTerminalStore, type TerminalSession } from "@/stores/terminalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { createTerminalSessionInScope } from "@/services/terminal/createTerminalSession";
import { useVisibleTerminalSessions } from "./useVisibleTerminalSessions";
import { oppositeTerminalPosition, isHorizontalTerminalAxis } from "./useTerminalPosition";
import { TerminalTabRename } from "./TerminalTabRename";
import "./TerminalTabBar.css";

interface TerminalTabBarProps {
  onClose: () => void;
  onRestart: () => void;
  /** "vertical" = right-side column (default, for bottom panel), "horizontal" = bottom row (for right panel) */
  orientation?: "vertical" | "horizontal";
  /** Current effective panel position — drives the swap control's direction. */
  position: EffectiveTerminalPosition;
  /** Present only while transcript rendering is enabled. */
  transcript?: { expanded: boolean; controls: string; onToggle: () => void };
}

/**
 * First GRAPHEME of a name, uppercased. `Array.from` splits by code point,
 * which keeps a surrogate pair together but still cuts a flag, a skin-toned
 * emoji, or a combining-mark cluster in half — Intl.Segmenter is the one that
 * gets those right, with a code-point fallback for environments without it.
 */
function firstGrapheme(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if ("Segmenter" in Intl) {
    const [first] = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      trimmed,
    );
    if (first) return first.segment.toUpperCase();
  }
  return (Array.from(trimmed)[0] ?? "?").toUpperCase();
}

/**
 * The compact glyph on a tab: the session's ORDINAL while it still carries its
 * default name, otherwise the first grapheme of whatever it is called now.
 * Deriving this from the session rather than from the label string is what
 * lets the label be translated (or renamed) without every tab collapsing to
 * the same character.
 */
function getTabDisplay(session: TerminalSession, displayName: string): string {
  return displayName === session.label && !session.isUserRenamed
    ? String(session.ordinal)
    : firstGrapheme(displayName);
}

/** Renders numbered buttons for switching between terminal sessions plus create/close/restart controls. */
export function TerminalTabBar({ onClose, onRestart, orientation = "vertical", position, transcript }: TerminalTabBarProps) {
  const { t } = useTranslation("statusbar");
  const { t: tSettings } = useTranslation("settings");
  // WI-TS3.1: the tab bar renders the VISIBLE population — the active
  // workspace scope's sessions ∪ window-scoped (everything with rail off).
  const sessions = useVisibleTerminalSessions();
  const activeId = useTerminalStore((s) => s.activeSessionId);

  const handleCreate = useCallback(() => {
    // The ONE owner-aware creation service (D-T1) — it
    // resolves the scope and applies the placeholder/restore/rail-off
    // carve-outs, identically to every other creator.
    createTerminalSessionInScope(getCurrentWindowLabel());
  }, []);

  // Swap flips the panel to the opposite end of its current axis. In auto
  // mode it toggles auto ↔ auto-flipped so the smart aspect-based axis
  // switching is preserved (it just lands on the other side); for an explicit
  // position it flips to the opposite explicit side.
  const handleSwap = useCallback(() => {
    const settings = useSettingsStore.getState();
    const setting = settings.terminal.position;
    if (setting === "auto" || setting === "auto-flipped") {
      settings.updateTerminalSetting("position", setting === "auto" ? "auto-flipped" : "auto");
    } else {
      settings.updateTerminalSetting("position", oppositeTerminalPosition(position));
    }
  }, [position]);
  const SwapIcon = isHorizontalTerminalAxis(position) ? ArrowLeftRight : ArrowUpDown;

  const handleSwitch = useCallback((id: string) => {
    useTerminalStore.getState().terminalSetActiveSession(id);
  }, []);

  // Which tab is being renamed, if any.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // A rename box must not survive its session leaving the VISIBLE set:
  // a rail switch mid-rename would otherwise resurrect
  // edit mode when the user returns to the scope. Adjusted during render (the
  // guarded one-way pattern TerminalPanel's `activated` latch uses) — an
  // effect calling setState synchronously trips the cascading-render lint.
  if (renamingId && !sessions.some((s) => s.id === renamingId)) {
    setRenamingId(null);
  }
  const handleRename = useCallback((id: string, name: string) => {
    useTerminalStore.getState().terminalRenameSession(id, name);
  }, []);

  // The cap gates on what the user can SEE (D-T5's visible union) — a hidden
  // scope's sessions do not consume this scope's headroom.
  const isMaxed = sessions.length >= MAX_TERMINAL_SESSIONS;
  // The transcript's strings live with its setting; asking for the namespace
  // through the hook is what loads it (a bare `{ ns }` option renders the key).
  const transcriptLabel = tSettings("terminal.transcript.title");

  return (
    <div className={`terminal-tab-bar ${orientation === "horizontal" ? "terminal-tab-bar--horizontal" : ""}`}>
      <div className="terminal-tab-bar-tabs">
        {sessions.map((s) => {
          // Program title (OSC 0/2) shows unless the user manually renamed the
          // session — explicit user intent wins over program output (G4).
          const name = s.isUserRenamed ? s.label : (s.programTitle || s.label);
          if (s.id === renamingId) {
            return (
              <TerminalTabRename
                key={s.id}
                initialName={name}
                label={t("terminal.renameSession")}
                onCommit={(next) => handleRename(s.id, next)}
                onDone={() => setRenamingId(null)}
              />
            );
          }
          return (
            <button
              key={s.id}
              className={`terminal-tab ${s.id === activeId ? "terminal-tab-active" : ""} ${!s.isAlive ? "terminal-tab-dead" : ""} ${s.hasActivity && s.id !== activeId ? "terminal-tab-activity" : ""}`}
              onClick={() => handleSwitch(s.id)}
              onDoubleClick={() => setRenamingId(s.id)}
              title={s.isAlive ? name : t("terminal.sessionExited", { name })}
              aria-label={s.isAlive ? name : t("terminal.sessionExited", { name })}
            >
              {getTabDisplay(s, name)}
              {s.hasActivity && s.id !== activeId && (
                <span className="sr-only">{t("terminal.backgroundActivity")}</span>
              )}
              {!s.isAlive && (
                <span className="terminal-tab-dead-glyph" aria-hidden="true">
                  ×
                </span>
              )}
            </button>
          );
        })}

        {/* data-terminal-action: stable automation hook (locale-independent,
            order-independent) — see TerminalTabBar.test.tsx and the E2E terminal
            journey. Do not rename these values. */}
        <button
          className="vm-icon-btn vm-icon-btn--sm"
          data-terminal-action="new"
          onClick={handleCreate}
          disabled={isMaxed}
          title={isMaxed ? t("terminal.maxSessions") : t("terminal.newSession")}
          aria-label={isMaxed ? t("terminal.maxSessions") : t("terminal.newSession")}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="terminal-tab-bar-actions">
        {transcript && (
          <button
            className="vm-icon-btn vm-icon-btn--sm"
            data-terminal-action="transcript"
            onClick={transcript.onToggle}
            title={transcriptLabel}
            aria-label={transcriptLabel}
            aria-pressed={transcript.expanded}
            aria-controls={transcript.expanded ? transcript.controls : undefined}
          >
            <ChartColumn size={14} />
          </button>
        )}
        <button className="vm-icon-btn vm-icon-btn--sm" data-terminal-action="swap" onClick={handleSwap} title={t("terminal.swapPosition")} aria-label={t("terminal.swapPosition")}>
          <SwapIcon size={14} />
        </button>
        <button className="vm-icon-btn vm-icon-btn--sm" data-terminal-action="close" onClick={onClose} title={t("terminal.closeSession")} aria-label={t("terminal.closeSession")}>
          <Trash2 size={14} />
        </button>
        <button className="vm-icon-btn vm-icon-btn--sm" data-terminal-action="restart" onClick={onRestart} title={t("terminal.restartSession")} aria-label={t("terminal.restartSession")}>
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
}
