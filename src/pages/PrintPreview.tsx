/**
 * Print Preview Page (v2)
 *
 * Uses ExportSurface for visual-parity rendering.
 * Waits for all assets (fonts, images, Math, Mermaid) before printing.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ExportSurface, type ExportSurfaceRef } from "@/export";
import { waitForAssets } from "@/export/waitForAssets";
import "@/export/exportStyles.css";

/** Event name for print request from main window */
const PRINT_REQUEST_EVENT = "export:print-request";

/** Fallback: Storage key for print content (legacy support) */
const PRINT_CONTENT_KEY = "vmark-print-content";

/** Maximum time to wait for rendering (ms) */
const MAX_RENDER_TIMEOUT = 10000;

interface PrintRequestPayload {
  markdown: string;
  title?: string;
  lightTheme?: boolean;
}

interface PrintStatus {
  stage: "loading" | "rendering" | "ready" | "error" | "warning";
  message?: string;
  warningCount?: number;
}

export function PrintPreviewPage() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [_title, setTitle] = useState<string>("Document");
  const [lightTheme, setLightTheme] = useState(true);
  const [status, setStatus] = useState<PrintStatus>({ stage: "loading" });
  const surfaceRef = useRef<ExportSurfaceRef>(null);
  const hasTriggeredPrint = useRef(false);

  // Close window handler
  const closeWindow = useCallback(() => {
    getCurrentWebviewWindow().close();
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeWindow();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeWindow]);

  // Trigger actual print
  const triggerPrint = useCallback(() => {
    hasTriggeredPrint.current = true;
    setStatus({ stage: "ready" });
    setTimeout(() => {
      window.print();
    }, 100);
  }, []);

  // Handle print when ready
  const handlePrint = useCallback(async () => {
    if (hasTriggeredPrint.current) return;

    const container = surfaceRef.current?.getContainer();
    if (!container) {
      setStatus({ stage: "error", message: "Failed to get content container" });
      return;
    }

    setStatus({ stage: "rendering", message: "Waiting for assets..." });

    // Wait for all assets to be ready
    const result = await waitForAssets(container, {
      timeout: MAX_RENDER_TIMEOUT,
      onProgress: (s) => {
        const pending: string[] = [];
        if (!s.fontsReady) pending.push("fonts");
        if (!s.imagesReady) pending.push("images");
        if (!s.mathReady) pending.push("math");
        if (!s.mermaidReady) pending.push("diagrams");

        if (pending.length > 0) {
          setStatus({
            stage: "rendering",
            message: `Loading ${pending.join(", ")}...`,
          });
        }
      },
    });

    if (result.warnings.length > 0) {
      console.warn("[PrintPreview] Asset warnings:", result.warnings);
    }

    // If assets didn't fully load, show warning and let user decide
    if (!result.success || result.warnings.length > 0) {
      setStatus({
        stage: "warning",
        message: "Some content may be incomplete.",
        warningCount: result.warnings.length,
      });
      return;
    }

    triggerPrint();
  }, [triggerPrint]);

  // Listen for print request from main window
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<PrintRequestPayload>(PRINT_REQUEST_EVENT, (event) => {
        const { markdown: md, title: t, lightTheme: lt } = event.payload;
        setMarkdown(md);
        if (t) setTitle(t);
        if (lt !== undefined) setLightTheme(lt);
      });
    };

    setupListener();

    // Fallback: check localStorage for legacy support
    const fallbackTimeout = setTimeout(() => {
      if (markdown === null) {
        const stored = localStorage.getItem(PRINT_CONTENT_KEY);
        if (stored !== null) {
          setMarkdown(stored);
          localStorage.removeItem(PRINT_CONTENT_KEY);
        }
      }
    }, 500);

    // Error timeout if no content arrives
    const errorTimeout = setTimeout(() => {
      if (markdown === null) {
        setStatus({
          stage: "error",
          message: "No content received. Please try again.",
        });
      }
    }, 5000);

    return () => {
      unlisten?.();
      clearTimeout(fallbackTimeout);
      clearTimeout(errorTimeout);
    };
  }, [markdown]);

  // Render status UI
  const renderStatus = () => {
    if (status.stage === "loading") {
      return (
        <div className="print-status print-status-loading">
          <span>Loading content...</span>
          <button className="print-cancel-btn" onClick={closeWindow} tabIndex={0}>
            Cancel
          </button>
        </div>
      );
    }

    if (status.stage === "rendering") {
      return (
        <div className="print-status print-status-rendering">
          <span>{status.message ?? "Preparing for print..."}</span>
          <button className="print-cancel-btn" onClick={closeWindow} tabIndex={0}>
            Cancel
          </button>
        </div>
      );
    }

    if (status.stage === "warning") {
      return (
        <div className="print-status print-status-warning">
          <span>{status.message ?? "Some content may be incomplete."}</span>
          <span className="print-status-hint">Print anyway?</span>
          <div className="print-status-actions">
            <button className="print-cancel-btn" onClick={closeWindow} tabIndex={0}>
              Cancel
            </button>
            <button className="print-confirm-btn" onClick={triggerPrint} tabIndex={0} autoFocus>
              Print
            </button>
          </div>
        </div>
      );
    }

    if (status.stage === "error") {
      return (
        <div className="print-status print-status-error">
          <span>{status.message ?? "An error occurred"}</span>
          <button className="print-cancel-btn" onClick={closeWindow} tabIndex={0}>
            Close
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={`print-preview-container ${lightTheme ? "" : "dark-theme"}`}>
      <style>{printPreviewStyles}</style>

      {/* Close button (always visible except when printing) */}
      <button
        className="print-close-btn"
        onClick={closeWindow}
        aria-label="Close"
        tabIndex={0}
      >
        ×
      </button>

      {markdown !== null ? (
        <ExportSurface
          ref={surfaceRef}
          markdown={markdown}
          lightTheme={lightTheme}
          onReady={handlePrint}
          onError={(error) => {
            setStatus({ stage: "error", message: error.message });
          }}
        />
      ) : (
        renderStatus()
      )}

      {/* Status overlay (hidden when printing) */}
      {status.stage !== "ready" && (
        <div className="print-status-overlay">{renderStatus()}</div>
      )}
    </div>
  );
}

/** Print preview styles */
const printPreviewStyles = `
.print-preview-container {
  min-height: 100vh;
  background: var(--bg-color, #f5f5f5);
}

/* Page layout container - shows paper boundaries */
.print-preview-container .export-surface {
  background: var(--bg-color, #f5f5f5);
  padding: 24px;
}

.print-preview-container .export-surface-editor {
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  padding: 1.5cm;
  max-width: 21cm; /* A4 width */
  min-height: 29.7cm; /* A4 height */
  margin: 0 auto;
  box-sizing: border-box;
}

/* Horizontal rule fix */
.print-preview-container hr {
  border: none;
  border-top: 1px solid var(--border-color, #d5d4d4);
  margin: 1.5em 0;
}

.print-close-btn {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1002;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: var(--bg-secondary, #e5e4e4);
  color: var(--text-secondary, #666666);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.print-close-btn:hover {
  background: var(--hover-bg-strong, rgba(0,0,0,0.08));
  color: var(--text-color, #1a1a1a);
}

.print-close-btn:focus-visible {
  outline: 2px solid var(--primary-color, #0066cc);
  outline-offset: 2px;
}

/* Full-screen blocking modal overlay */
.print-status-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1001;
  display: flex;
  align-items: center;
  justify-content: center;
}

.print-status {
  background: white;
  padding: 32px 48px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  text-align: center;
  color: var(--text-secondary, #666666);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 400px;
}

.print-status-error {
  color: var(--error-color, #cf222e);
}

.print-status-warning {
  color: var(--warning-color, #9a6700);
}

.print-status-hint {
  font-size: 14px;
  color: var(--text-tertiary, #999999);
}

.print-status-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.print-cancel-btn,
.print-confirm-btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.print-cancel-btn {
  background: var(--bg-secondary, #e5e4e4);
  color: var(--text-color, #1a1a1a);
}

.print-cancel-btn:hover {
  background: var(--hover-bg-strong, rgba(0,0,0,0.12));
}

.print-confirm-btn {
  background: var(--primary-color, #0066cc);
  color: var(--contrast-text, white);
}

.print-confirm-btn:hover {
  background: color-mix(in srgb, var(--primary-color, #0066cc) 85%, black);
}

.print-cancel-btn:focus-visible,
.print-confirm-btn:focus-visible {
  outline: 2px solid var(--primary-color, #0066cc);
  outline-offset: 2px;
}

@media print {
  .print-status-overlay,
  .print-close-btn {
    display: none !important;
  }

  .print-preview-container {
    background: white !important;
  }

  .print-preview-container .export-surface {
    background: white !important;
    padding: 0 !important;
  }

  .print-preview-container .export-surface-editor {
    box-shadow: none !important;
    padding: 0 !important;
    max-width: none !important;
    min-height: auto !important;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  @page {
    margin: 1.5cm;
  }
}
`;
