/**
 * EditorArea — composes the editor pane, bottom-bar mux, and optional
 * side/bottom panel (terminal today; Assistant pane tomorrow).
 *
 * Per ADR-007, EditorArea is a pure layout helper — no store imports.
 * The dynamic panel positioning (top/bottom/left/right) is the only layout
 * intelligence: left/right use a row axis, top/left draw the panel before
 * the editor. Everything else is pass-through composition.
 *
 * The panel always occupies ONE child slot, after the editor column; top/left
 * reverse the flex axis instead of moving it. Moving it between slots made
 * React unmount and remount it on every top↔bottom / left↔right swap, and the
 * terminal's unmount kills its PTYs — a running Claude session died with it.
 * The cost is that for top/left the DOM (and so Tab) order puts the panel after
 * the editor while it is drawn before; the two are independent landmarks, so
 * no reading sequence depends on that order.
 *
 * The editor + bottom-bar are siblings inside a flex column so the
 * bottom bar (at least 40px, growing with the FindBar) always hugs the editor. The panel arranges around
 * that column based on panelPosition.
 *
 * The `main` ARIA landmark wraps only the editor (not the bottom bar) so
 * StatusBar's `contentinfo` landmark stays a top-level sibling.
 *
 * @module shell/EditorArea
 */

import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

import { BAR_HEIGHT } from "@/shell/shellChrome";

const BOTTOM_BAR_HEIGHT = BAR_HEIGHT;

type PanelPosition = "top" | "bottom" | "left" | "right";

export interface EditorAreaProps {
  /** The editor surface. */
  editor: ReactNode;
  /** Bottom-bar mux (StatusBar / Toolbar / FindBar), in a lane at least 40px
   *  high that grows with the in-flow FindBar. */
  bottomBar: ReactNode;
  /** Optional side or bottom panel (terminal today). */
  panel?: ReactNode;
  /** Where the panel sits relative to the editor. */
  panelPosition: PanelPosition;
  /**
   * Optional full-height right-docked surface (Knowledge Base today).
   *
   * Separate from `panel` so it composes with the terminal at any
   * `panelPosition` instead of competing for the same slot. Docking here makes
   * such a panel DISPLACE the editor; rendering it as a `position: fixed`
   * overlay instead would occlude the document underneath it.
   */
  sidePanel?: ReactNode;
}

export function EditorArea({
  editor,
  bottomBar,
  panel,
  panelPosition,
  sidePanel,
}: EditorAreaProps) {
  const { t } = useTranslation();

  // left/right share a row axis; top/left draw the panel first by REVERSING
  // the axis — never by moving the panel to another slot (see header).
  const horizontal = panelPosition === "left" || panelPosition === "right";
  const panelFirst = panelPosition === "top" || panelPosition === "left";
  const axis = horizontal ? "row" : "column";

  const panelAxis = (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: panelFirst ? `${axis}-reverse` : axis,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {/* `role="main"` wraps only the editor so the bottom bar's
            contentinfo landmark (StatusBar) stays a top-level sibling, not
            nested inside main (axe landmark-contentinfo-is-top-level). */}
        <div
          role="main"
          aria-label={t("aria.mainContent")}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          {editor}
        </div>
        {/* At LEAST one bar high: the in-flow FindBar grows it when its replace
            row opens or its controls wrap, and the editor above shrinks — a
            fixed 40px lane let the taller bar rise over the document. */}
        <div
          style={{
            position: "relative",
            minHeight: BOTTOM_BAR_HEIGHT,
            flexShrink: 0,
            // Bottom-anchor in-flow bars, as the absolute FindBar was.
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}
        >
          {bottomBar}
        </div>
      </div>
      {panel}
    </div>
  );

  // Only wrap when a side dock exists, so the DOM (and the panel-positioning
  // contract above) is byte-identical for every window that has none.
  if (!sidePanel) return panelAxis;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "row",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {panelAxis}
      {sidePanel}
    </div>
  );
}
