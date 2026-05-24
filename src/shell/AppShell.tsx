/**
 * AppShell — composition root for the application window.
 *
 * Per ADR-007 (shell as composition root), AppShell is a pure layout
 * primitive: it knows the named slot positions and nothing about features,
 * stores, or plugins. Features mount into slots; lifecycle hooks live
 * outside the Shell.
 *
 * Slots:
 *   - chrome     fixed top region (title bar, drag region). 40px reserved.
 *   - sidebar    optional left rail; pass null to omit.
 *   - primary    the main content area (editor, panels, etc).
 *   - overlays   z-stacked overlays/portals at app level.
 *
 * Behavior modifiers (focus-mode, typewriter-mode, find-bar-open) are
 * passed as className; CSS vars (e.g., --sidebar-offset) are passed as
 * style. AppShell forwards both to its root element.
 *
 * @module shell/AppShell
 */

import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./app-shell.css";

/** Height of the chrome (title-bar) area, in pixels. */
const CHROME_HEIGHT = 40;

export interface AppShellProps {
  /** Fixed-position chrome region (title bar). Rendered above content. */
  chrome?: ReactNode;
  /** Optional left-rail sidebar; pass null to omit. */
  sidebar?: ReactNode;
  /** Width of the sidebar aside, in pixels. Defaults to 0 when sidebar is null. */
  sidebarWidth?: number;
  /** The main content area. */
  primary: ReactNode;
  /** App-level overlays (drop zone, dialogs, palettes). */
  overlays?: ReactNode;
  /** Class names appended to the shell root (e.g., layout modifiers). */
  className?: string;
  /** Inline style on the shell root (CSS vars are inheritable from here). */
  style?: CSSProperties;
}

export function AppShell({
  chrome,
  sidebar,
  sidebarWidth = 0,
  primary,
  overlays,
  className,
  style,
}: AppShellProps) {
  const { t } = useTranslation();
  const rootClass = ["app-shell", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass} style={style}>
      {overlays}
      {chrome}
      {sidebar ? (
        <aside
          aria-label={t("aria.sidebar")}
          className="app-shell__sidebar"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          {sidebar}
        </aside>
      ) : null}
      <div className="app-shell__primary" style={{ paddingTop: CHROME_HEIGHT }}>
        {primary}
      </div>
    </div>
  );
}
