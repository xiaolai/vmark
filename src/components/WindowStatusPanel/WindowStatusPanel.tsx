/**
 * WindowStatusPanel (#1057) — lists every other open VMark window with its live
 * Claude Code status and jumps to it on click.
 *
 * Presentational + thin behavior: reads the cross-window snapshot from
 * `windowStatusStore` (kept current by `useWindowStatus`) and focuses a window
 * via the `focus_window` Tauri command. Status is the two reliable signals —
 * AI-genie state and terminal-bell attention — ranked attention-first.
 *
 * @module components/WindowStatusPanel/WindowStatusPanel
 */
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X, Bell } from "lucide-react";
import {
  useWindowStatusStore,
  selectWindows,
  selectOtherWindowsRanked,
  type WindowStatusEntry,
} from "@/stores/windowStatusStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import "./window-status-panel.css";

type StatusKey = "attention" | "error" | "running" | "idle";

function statusKey(w: WindowStatusEntry): StatusKey {
  if (w.attention) return "attention";
  if (w.ai === "error") return "error";
  if (w.ai === "running") return "running";
  return "idle";
}

export function WindowStatusPanel() {
  const { t } = useTranslation("common");
  const windows = useWindowStatusStore(selectWindows);
  const self = getCurrentWindowLabel();
  const others = selectOtherWindowsRanked(windows, self);

  const close = () => useWindowStatusStore.getState().setPanelOpen(false);
  const goTo = (label: string) => {
    void invoke("focus_window", { label }).catch(() => {});
    close();
  };

  return (
    <div
      className="window-status-panel"
      role="dialog"
      aria-label={t("windowStatus.title")}
      data-testid="window-status-panel"
    >
      <header className="window-status-panel__header">
        <span className="window-status-panel__title">{t("windowStatus.title")}</span>
        <button
          type="button"
          className="window-status-panel__close"
          onClick={close}
          title={t("close")}
          aria-label={t("close")}
        >
          <X size={14} />
        </button>
      </header>

      {others.length === 0 ? (
        <p className="window-status-panel__empty">{t("windowStatus.empty")}</p>
      ) : (
        <ul className="window-status-panel__list">
          {others.map((w) => {
            const k = statusKey(w);
            const name = w.docName || t("windowStatus.untitled");
            const status = t(`windowStatus.status.${k}`);
            return (
              <li key={w.label}>
                <button
                  type="button"
                  className="window-status-row"
                  onClick={() => goTo(w.label)}
                  aria-label={`${name} — ${status}. ${t("windowStatus.goToHint")}`}
                >
                  <span className={`window-status-dot window-status-dot--${k}`} aria-hidden="true">
                    {k === "attention" ? <Bell size={11} /> : null}
                  </span>
                  <span className="window-status-row__name">{name}</span>
                  <span className="window-status-row__status">{status}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
