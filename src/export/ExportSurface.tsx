/**
 * ExportSurface — read-only Tiptap rendering of markdown for export and
 * print, which reports when the rendered output is stable.
 *
 * @module export/ExportSurface
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { createExportExtensions } from "./createExportExtensions";
import { isImageSettled } from "./waitForAssets";
import { exportWarn, exportError } from "@/utils/debug";
import "./exportStyles.css";

/** Props for the ExportSurface component. */
export interface ExportSurfaceProps {
  /** Markdown content to render */
  markdown: string;
  /** Called when rendering is complete and stable */
  onReady?: () => void;
  /** Called if rendering fails */
  onError?: (error: Error) => void;
  /** Whether to use light theme (default: true) */
  lightTheme?: boolean;
  /** Additional CSS class for the container */
  className?: string;
}

/** Imperative handle for extracting rendered HTML and the container element from ExportSurface. */
export interface ExportSurfaceRef {
  /** Get the rendered HTML content */
  getHTML: () => string;
  /** Get the container element */
  getContainer: () => HTMLElement | null;
}

/**
 * ExportSurface renders markdown using a read-only Tiptap editor.
 *
 * This component guarantees visual parity with the WYSIWYG editor by using
 * the same extensions and CSS. It's designed for export/print scenarios
 * where we need the exact same rendering as the editor.
 *
 * Features:
 * - Read-only (no editing interactions)
 * - Same extensions as editor (minus interactive popups/tooltips)
 * - Math/Mermaid rendering via codePreviewExtension
 * - Async stability detection (waits for fonts, images, async renders)
 *
 * @example
 * ```tsx
 * <ExportSurface
 *   markdown="# Hello\n\n$$E=mc^2$$"
 *   onReady={() => console.log('Ready to export')}
 * />
 * ```
 */
export const ExportSurface = forwardRef<ExportSurfaceRef, ExportSurfaceProps>(
  function ExportSurface(
    { markdown, onReady, onError, lightTheme = true, className },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const stabilityCheckRef = useRef<number | null>(null);
    const onReadyCalledRef = useRef(false);

    // Create extensions once
    const extensions = createExportExtensions();

    const editor = useEditor({
      extensions,
      editable: false,
      editorProps: {
        attributes: {
          class: "export-surface-editor tiptap-editor",
          "data-export-mode": "true",
        },
      },
    });

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      getHTML: () => {
        /* v8 ignore next -- @preserve reason: the handle exists only while mounted, and the ref is set on mount */
        if (!containerRef.current) return "";
        const editorEl = containerRef.current.querySelector(".ProseMirror");
        /* v8 ignore next -- @preserve reason: EditorContent always mounts a .ProseMirror element; the fallback is defensive */
        return editorEl?.innerHTML ?? "";
      },
      getContainer: () => containerRef.current,
    }));

    // Check if all async content has rendered
    const checkStability = useCallback(async (): Promise<boolean> => {
      /* v8 ignore next -- @preserve reason: an unmount clears the pending poll, so a check never runs without the container */
      if (!containerRef.current) return false;

      // Check for pending math renders (placeholder text)
      const mathPlaceholders = containerRef.current.querySelectorAll(
        ".code-block-preview-placeholder"
      );
      if (mathPlaceholders.length > 0) return false;

      // Check for pending mermaid renders
      const mermaidLoading = containerRef.current.querySelectorAll(
        ".mermaid-loading"
      );
      if (mermaidLoading.length > 0) return false;

      // Defer image readiness to the shared `isImageSettled` predicate so
      // both stability paths (this internal check + waitForAssets) agree on
      // when an `<img>` is actually done — including the terminal error case
      // (empty src + .image-error) that would otherwise force the full
      // timeout. See issue #837.
      const images = containerRef.current.querySelectorAll("img");
      for (const img of images) {
        if (!isImageSettled(img)) return false;
      }

      // Wait for fonts
      try {
        await document.fonts.ready;
      } catch {
        // Font API not available in some environments, continue
      }

      return true;
    }, []);

    // Poll for stability then call onReady
    const waitForStability = useCallback(async () => {
      /* v8 ignore next -- @preserve reason: reached only when the markdown prop changes after onReady; every caller mounts one surface per render */
      if (onReadyCalledRef.current) return;

      const maxAttempts = 50; // 5 seconds max
      let attempts = 0;

      const check = async () => {
        attempts++;
        const isStable = await checkStability();

        if (isStable) {
          // Extra frame for layout
          requestAnimationFrame(() => {
            /* v8 ignore next -- @preserve reason: a second poll chain exists only after a markdown change mid-poll, which no caller makes */
            if (!onReadyCalledRef.current) {
              onReadyCalledRef.current = true;
              onReady?.();
            }
          });
        } else if (attempts < maxAttempts) {
          stabilityCheckRef.current = window.setTimeout(check, 100);
        } else {
          // Timeout - call onReady anyway with warning
          exportWarn("Stability timeout reached, proceeding anyway");
          if (!onReadyCalledRef.current) {
            onReadyCalledRef.current = true;
            onReady?.();
          }
        }
      };

      // Start checking after a short delay for initial render
      stabilityCheckRef.current = window.setTimeout(check, 100);
    }, [checkStability, onReady]);

    // Load content when editor is ready
    useEffect(() => {
      if (!editor || !markdown) return;

      try {
        const doc = parseMarkdown(editor.schema, markdown);
        editor.commands.setContent(doc.toJSON());

        // Start stability check
        void waitForStability().catch((e) => exportError("Export stability check failed:", e));
      } catch (error) {
        exportError("Failed to parse markdown for export surface:", error);
        /* v8 ignore next -- @preserve reason: no known markdown makes the pipeline throw, so the failure cannot be produced without mocking it */
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }, [editor, markdown, waitForStability, onError]);

    // Cleanup
    useEffect(() => {
      return () => {
        if (stabilityCheckRef.current) {
          clearTimeout(stabilityCheckRef.current);
        }
      };
    }, []);

    const themeClass = lightTheme ? "" : "dark-theme";
    const surfaceClass = `export-surface ${themeClass} ${className ?? ""}`;

    return (
      <div
        ref={containerRef}
        className={surfaceClass}
      >
        <EditorContent editor={editor} />
      </div>
    );
  }
);
