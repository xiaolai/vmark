/**
 * WindowStatusPanel (#1057) — lists every other open VMark window with its live
 * Claude Code status and jumps to it on click.
 *
 * Presentational + thin behavior: reads the cross-window snapshot from
 * `windowStatusStore` (kept current by `useWindowStatus`) and focuses a window
 * via the `focus_window` Tauri command. Status is the two reliable signals —
 * AI-genie state and terminal-bell attention — ranked attention-first.
 *
 * The pin control scopes the panel's "mission control" persistence: a dropdown
 * offers "Pin this window" (#1120) and "Pin all windows" — the app-global pin
 * that auto-opens the panel in every window, including ones opened later, and
 * is broadcast so open windows follow immediately (#1135).
 *
 * @coordinates-with hooks/useWindowStatus.ts — seeds the snapshot + global-pin sync
 * @module components/WindowStatusPanel/WindowStatusPanel
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { X, Bell, Pin, Check } from "lucide-react";
import {
  useWindowStatusStore,
  selectWindows,
  selectPinned,
  selectGlobalPin,
  selectEffectivePinned,
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
  const pinned = useWindowStatusStore(selectPinned);
  const globalPin = useWindowStatusStore(selectGlobalPin);
  const effectivePinned = useWindowStatusStore(selectEffectivePinned);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);
  const self = getCurrentWindowLabel();
  const others = selectOtherWindowsRanked(windows, self);

  // Close the pin menu on outside-click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pinRef.current && !pinRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const close = () => useWindowStatusStore.getState().setPanelOpen(false);

  const pinThisWindow = () => {
    useWindowStatusStore.getState().togglePinned();
    setMenuOpen(false);
  };

  const pinAllWindows = () => {
    const next = !useWindowStatusStore.getState().globalPin;
    useWindowStatusStore.getState().setGlobalPin(next);
    // Broadcast so every OTHER open window follows immediately; windows opened
    // later read the persisted flag at startup instead (#1135).
    void emit("window-status:global-pin", next).catch(() => {});
    setMenuOpen(false);
  };

  const goTo = (label: string) => {
    // Close after the focus succeeds — UNLESS pinned (this window or globally),
    // where the panel stays put as persistent "mission control" (#1120/#1135).
    // If the target window is gone/stale, keep the panel open and refresh the
    // list so the dead row drops out immediately.
    void invoke("focus_window", { label })
      .then(() => {
        const s = useWindowStatusStore.getState();
        if (!(s.pinned || s.globalPin)) close();
      })
      .catch(() => {
        void invoke<WindowStatusEntry[]>("get_window_statuses")
          .then((list) => useWindowStatusStore.getState().setWindows(list))
          .catch(() => {});
      });
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
        <div className="window-status-panel__actions">
          <div className="window-status-panel__pin-wrap" ref={pinRef}>
            <button
              type="button"
              className="window-status-panel__pin"
              onClick={() => setMenuOpen((o) => !o)}
              title={t("windowStatus.pin")}
              aria-label={t("windowStatus.pin")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-pinned={effectivePinned || undefined}
              data-global={globalPin || undefined}
            >
              <Pin size={14} />
            </button>
            {menuOpen ? (
              <div className="window-status-panel__pin-menu" role="menu">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={pinned}
                  className="window-status-panel__pin-item"
                  onClick={pinThisWindow}
                >
                  <span className="window-status-panel__pin-check" aria-hidden="true">
                    {pinned ? <Check size={13} /> : null}
                  </span>
                  {t("windowStatus.pinThisWindow")}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={globalPin}
                  className="window-status-panel__pin-item"
                  onClick={pinAllWindows}
                >
                  <span className="window-status-panel__pin-check" aria-hidden="true">
                    {globalPin ? <Check size={13} /> : null}
                  </span>
                  {t("windowStatus.pinAllWindows")}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="window-status-panel__close"
            onClick={close}
            title={t("close")}
            aria-label={t("close")}
          >
            <X size={14} />
          </button>
        </div>
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
