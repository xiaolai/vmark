/**
 * Off-screen markdown → HTML rendering via ExportSurface.
 *
 * Purpose: split from useExportOperations.ts (file-size gate) — the one
 * DOM-heavy primitive every export operation shares: mount an ExportSurface
 * in a hidden container, wait for assets (fonts, images, math, diagrams) to
 * stabilise, extract the HTML, and tear the container down again.
 *
 * @coordinates-with useExportOperations.ts — the only consumer
 * @module export/renderMarkdownToHtml
 */

import React from "react";
import { createRoot } from "react-dom/client";

import { ExportSurface, type ExportSurfaceRef } from "./ExportSurface";
import { waitForAssets } from "./waitForAssets";
import i18n from "@/i18n";
import { toError } from "@/utils/errorMessage";

/** Timeout for waiting on assets (fonts, images, math, diagrams) */
const ASSET_WAIT_TIMEOUT = 10000;

/** Maximum time to wait for render before giving up */
const RENDER_TIMEOUT = 15000;

/**
 * Render markdown to HTML using ExportSurface.
 * Creates a temporary DOM element, renders ExportSurface, waits for stability,
 * then extracts the HTML.
 */
export async function renderMarkdownToHtml(
  markdown: string,
  lightTheme: boolean = true
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Guard against multiple resolution (timeout vs callback race)
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Create temporary container
    const container = document.createElement("div");
    container.style.cssText = "position: absolute; left: -9999px; top: -9999px;";
    document.body.appendChild(container);

    const surfaceRef = React.createRef<ExportSurfaceRef>();
    let root: ReturnType<typeof createRoot> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      root?.unmount();
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    };

    const complete = (html: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(html);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleReady = async () => {
      if (settled) return;
      try {
        // Wait for assets
        const surfaceContainer = surfaceRef.current?.getContainer();
        if (surfaceContainer) {
          await waitForAssets(surfaceContainer, { timeout: ASSET_WAIT_TIMEOUT });
        }

        // Extract HTML
        const html = surfaceRef.current?.getHTML() ?? "";
        complete(html);
      } catch (error) {
        fail(toError(error));
      }
    };

    const handleError = (error: Error) => {
      fail(error);
    };

    // Render ExportSurface
    try {
      root = createRoot(container);
      root.render(
        React.createElement(ExportSurface, {
          ref: surfaceRef,
          markdown,
          lightTheme,
          onReady: () => void handleReady(),
          onError: handleError,
        })
      );
    } catch (error) {
      cleanup();
      reject(toError(error));
      return;
    }

    // Timeout fallback
    timeoutId = setTimeout(() => {
      if (settled) return;
      const html = surfaceRef.current?.getHTML();
      if (html) {
        complete(html);
      } else {
        fail(new Error(i18n.t("dialog:toast.exportRenderTimedOut")));
      }
    }, RENDER_TIMEOUT);
  });
}
