/**
 * AppShell — composition root for the application window.
 *
 * Per ADR-007 (shell as composition root), AppShell is a pure layout
 * primitive: it knows the named slot positions and nothing about features,
 * stores, or plugins. Features mount into slots; lifecycle hooks live
 * outside the Shell.
 *
 * Slots:
 *   - chrome     fixed top region (title bar, drag region); pass null to omit.
 *                40px is reserved only when it is filled — see below.
 *   - sidebar    optional left rail; pass null to omit.
 *   - primary    the main content area (editor, panels, etc).
 *   - overlays   z-stacked overlays/portals at app level.
 *
 * The chrome reservation follows the slot rather than being unconditional: the
 * strip and the space held for it are one decision, and splitting them left an
 * empty 40px band at the top of every Windows/Linux window, where the OS draws
 * its own title bar and no chrome is passed (#1296). Which platforms fill the
 * slot is the composition root's business, not the shell's.
 *
 * Behavior modifiers (focus-mode, typewriter-mode, find-bar-open) are
 * passed as className; CSS vars (e.g., --sidebar-offset) are passed as
 * style. AppShell forwards both to its root element.
 *
 * @module shell/AppShell
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BAR_HEIGHT } from "./shellChrome";
import "./app-shell.css";

/**
 * Height of the chrome (title-bar) area, in pixels. Reserved only when filled.
 *
 * Published to CSS as `--chrome-height` below, because the chrome's own
 * stylesheet needs the same number: `.title-bar` is `position: absolute` and
 * must be exactly as tall as the space reserved for it. Two literals would drift
 * without any test noticing — this one's test reads the constant, and CSS reads
 * the variable, so both sides now come from here.
 *
 * DERIVED from `shellChrome.BAR_HEIGHT` (R11 — one bar height). The strip is
 * absolutely positioned over the WHOLE shell, so the sidebar and the workspace
 * rail have to clear it too — `shellChrome.ts` keeps its own internal alias as
 * an input to `SHELL_TOP_INSET`, which is layout maths that must not import a
 * React component to read a number.
 */
export const CHROME_HEIGHT = BAR_HEIGHT;

export interface AppShellProps {
  /**
   * Fixed-position chrome region (title bar). Rendered above content, and the
   * only slot whose presence changes the layout — hence `ReactElement | null`
   * rather than `ReactNode`. A `ReactNode` cannot be tested for "renders
   * something": `0` is falsy but renders, `true` and `[]` are truthy but do not,
   * so either would have desynced the strip from the space held for it.
   */
  chrome?: ReactElement | null;
  /** Optional left-rail sidebar; pass null to omit. */
  sidebar?: ReactNode;
  /** Width of the sidebar aside, in pixels. Defaults to 0 whenever it is omitted — including with a sidebar present, which then renders collapsed. */
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
  // The caller's style wins on every key it sets; --chrome-height is the
  // shell's own, so it is applied after (see CHROME_HEIGHT).
  // --shell-side-width publishes the same number that sizes the aside below,
  // because the browser-mode title bar must start where the leading column
  // ends (title-bar.css) — restating that offset from parts is how the strip
  // once overpainted the leading card's top corner.
  const rootStyle: CSSProperties = {
    ...style,
    "--chrome-height": `${CHROME_HEIGHT}px`,
    "--shell-side-width": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className={rootClass} style={rootStyle}>
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
      <div className="app-shell__primary" style={{ paddingTop: chrome ? CHROME_HEIGHT : 0 }}>
        {primary}
      </div>
    </div>
  );
}
