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

/**
 * One margin field.
 *
 * Extracted because the same input existed four times, differing only by side
 * and value — and the duplication had already propagated a defect: every copy
 * declared `step={1}` while the shipped presets are 25.4, 12.7 and 38.1mm, so
 * the field was step-mismatched and the spinner snapped away the fraction.
 * Fixing that once meant fixing it four times, which is the argument.
 *
 * The rounding to one decimal matches `step` deliberately: A4's 25.4mm is an
 * inch, and letting it become 25 silently changes the page geometry.
 */
function MarginInput({
  side, value, onChange,
}: {
  side: MarginSide;
  value: number;
  onChange: (side: MarginSide, value: number) => void;
}) {
  return (
    <input
      type="number"
      className="margin-layout-input"
      value={value}
      min={0}
      max={100}
      step={0.1}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v) && v >= 0 && v <= 100) {
          onChange(side, Math.round(v * 10) / 10);
        }
      }}
    />
  );
}

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
  return (
    <div className="margin-layout">
      <div className="margin-layout-top">
        <MarginInput side="marginTop" value={top} onChange={onChange} />
      </div>
      <div className="margin-layout-middle">
        <MarginInput side="marginLeft" value={left} onChange={onChange} />
        <div className={`margin-layout-page ${landscape ? "margin-layout-page--landscape" : ""}`} />
        <MarginInput side="marginRight" value={right} onChange={onChange} />
      </div>
      <div className="margin-layout-bottom">
        <MarginInput side="marginBottom" value={bottom} onChange={onChange} />
      </div>
      <span className="margin-layout-unit">{unitLabel}</span>
    </div>
  );
}
