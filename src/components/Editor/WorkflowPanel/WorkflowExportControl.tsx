/**
 * Purpose: Export control for the GHA workflow canvas. A single button
 *   that opens a small menu offering "Copy as Mermaid", "Export as SVG",
 *   and "Export as PNG". This is the only UI entry point for the
 *   ghaWorkflow/export functions (toMermaid + exportCanvas) — wired into
 *   WorkflowCanvas so both the inline panel and the side panel surface it.
 *
 *   RW-7 (L3) — wire GHA workflow export to UI.
 *
 * Key decisions:
 *   - Pure dispatch + UX. The clipboard / save-dialog / writeFile glue
 *     lives in lib/ghaWorkflow/export/saveExport.ts so it stays
 *     unit-testable without mounting xyflow.
 *   - exportCanvas reads the live `.react-flow__viewport` from the DOM;
 *     this control just names the format. It must therefore mount inside
 *     the same canvas wrapper as React Flow.
 *   - An in-flight guard prevents rapid repeated clicks from triggering
 *     duplicate clipboard writes, save dialogs, or toasts; the trigger and
 *     menu items disable while an export runs.
 *
 * @coordinates-with src/lib/ghaWorkflow/export/toMermaid.ts
 * @coordinates-with src/lib/ghaWorkflow/export/saveExport.ts
 * @module components/Editor/WorkflowPanel/WorkflowExportControl
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { toMermaid } from "@/lib/ghaWorkflow/export/toMermaid";
import { copyMermaid, saveImage } from "@/lib/ghaWorkflow/export/saveExport";
import { imeToast as toast } from "@/services/ime/imeToast";
import { errorMessage } from "@/utils/errorMessage";
import "./workflow-export-control.css";

const EXPORT_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

interface WorkflowExportControlProps {
  workflow: WorkflowIR;
}

export function WorkflowExportControl({
  workflow,
}: WorkflowExportControlProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // audit-fix — in-flight guard: rapid repeated clicks must not trigger
  // duplicate clipboard writes, save dialogs, or toasts.
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  // Close on outside click or Escape (rules/50 §2 — store refs, clean up
  // on unmount). The handlers are stable so a single effect suffices.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleMermaid = useCallback(async () => {
    setOpen(false);
    // audit-fix — bail if an export is already running.
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const ok = await copyMermaid(toMermaid(workflow));
      if (ok) {
        toast.success(t("panel.exportMermaid"), {
          description: t("panel.exportMermaidLossy"),
        });
      } else {
        toast.error(t("panel.exportError"));
      }
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [workflow, t]);

  const handleImage = useCallback(
    async (format: "svg" | "png") => {
      setOpen(false);
      // audit-fix — bail if an export is already running.
      if (exportingRef.current) return;
      exportingRef.current = true;
      setExporting(true);
      try {
        const result = await saveImage(format);
        if (result === "saved") {
          toast.success(
            format === "svg" ? t("panel.exportSvg") : t("panel.exportPng"),
            format === "svg"
              ? { description: t("panel.exportSvgLossy") }
              : undefined,
          );
        }
      } catch (error) {
        toast.error(`${t("panel.exportError")}: ${errorMessage(error)}`);
      } finally {
        exportingRef.current = false;
        setExporting(false);
      }
    },
    [t],
  );

  return (
    <div className="workflow-export-control" ref={rootRef}>
      <button
        type="button"
        className="workflow-export-control__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("panel.exportLabel")}
        title={t("panel.exportLabel")}
        disabled={exporting}
        onClick={() => setOpen((v) => !v)}
      >
        {EXPORT_ICON}
      </button>
      {open && (
        <div className="workflow-export-control__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="workflow-export-control__item"
            disabled={exporting}
            onClick={handleMermaid}
          >
            {t("panel.exportMermaid")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="workflow-export-control__item"
            disabled={exporting}
            onClick={() => handleImage("svg")}
          >
            {t("panel.exportSvg")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="workflow-export-control__item"
            disabled={exporting}
            onClick={() => handleImage("png")}
          >
            {t("panel.exportPng")}
          </button>
        </div>
      )}
    </div>
  );
}
