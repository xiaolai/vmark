/**
 * Layout primitives for the PDF export sidebar.
 *
 * Purpose: these three are pure presentation — an icon-plus-items row, a
 * disclosure wrapper, and the margin diagram. None of them knows what a
 * `PdfOptions` is. Separating them leaves `PdfSettingsSidebar.tsx` as the
 * composition of settings it is meant to be, rather than that plus a small
 * widget library.
 *
 * @module export/PdfSidebarPrimitives
 * @coordinates-with PdfSettingsSidebar.tsx — the only consumer
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import "./pdf-margin-layout.css";

/** An icon gutter beside a column of setting rows. */
export function PdfSettingsGroup({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pdf-settings-group">
      <div className="pdf-settings-group-icon">{icon}</div>
      <div className="pdf-settings-group-items">{children}</div>
    </div>
  );
}

/** Collapsible section for the sidebar. */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <button
        className="pdf-collapsible-header"
        data-open={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight />
        {title}
      </button>
      {open && children}
    </div>
  );
}

export type MarginSide = "marginTop" | "marginRight" | "marginBottom" | "marginLeft";

/** Visual page margin diagram with editable mm inputs on all 4 sides. */
export function MarginLayoutDiagram({
  top, right, bottom, left, landscape, unitLabel, onChange,
}: {
  top: number;
  right: number;
  bottom: number;
  left: number;
  landscape: boolean;
  unitLabel: string;
  onChange: (side: MarginSide, value: number) => void;
}) {
  const handleChange = (side: MarginSide, raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isNaN(v) && v >= 0 && v <= 100) {
      onChange(side, Math.round(v * 10) / 10);
    }
  };

  return (
    <div className="margin-layout">
      <div className="margin-layout-top">
        <input
          type="number"
          className="margin-layout-input"
          value={top}
          min={0} max={100} step={1}
          onChange={(e) => handleChange("marginTop", e.target.value)}
        />
      </div>
      <div className="margin-layout-middle">
        <input
          type="number"
          className="margin-layout-input"
          value={left}
          min={0} max={100} step={1}
          onChange={(e) => handleChange("marginLeft", e.target.value)}
        />
        <div className={`margin-layout-page ${landscape ? "margin-layout-page--landscape" : ""}`} />
        <input
          type="number"
          className="margin-layout-input"
          value={right}
          min={0} max={100} step={1}
          onChange={(e) => handleChange("marginRight", e.target.value)}
        />
      </div>
      <div className="margin-layout-bottom">
        <input
          type="number"
          className="margin-layout-input"
          value={bottom}
          min={0} max={100} step={1}
          onChange={(e) => handleChange("marginBottom", e.target.value)}
        />
      </div>
      <span className="margin-layout-unit">{unitLabel}</span>
    </div>
  );
}
