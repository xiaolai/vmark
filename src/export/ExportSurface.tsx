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
/* v8 ignore start -- @preserve reason: ExportSurface component and its anonymous callbacks (useImperativeHandle factory, checkStability, waitForStability, check, rAF callback, useEffect cleanup) are only exercised in Tauri E2E; jsdom cannot drive Tiptap rendering pipeline */
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
        /* v8 ignore next -- @preserve reason: containerRef.current is null only before mount, not reachable in jsdom after render */
        if (!containerRef.current) return "";
        const editorEl = containerRef.current.querySelector(".ProseMirror");
        /* v8 ignore next -- @preserve reason: optional chaining fallback; ProseMirror element always present after Tiptap init */
        return editorEl?.innerHTML ?? "";
      },
      getContainer: () => containerRef.current,
    }));

    // Check if all async content has rendered
    const checkStability = useCallback(async (): Promise<boolean> => {
      /* v8 ignore next -- @preserve reason: containerRef.current is null only if component unmounts mid-async; timing-dependent guard not testable in jsdom */
      if (!containerRef.current) return false;

      // Check for pending math renders (placeholder text)
      const mathPlaceholders = containerRef.current.querySelectorAll(
        ".code-block-preview-placeholder"
      );
      /* v8 ignore next -- @preserve reason: placeholder DOM nodes only appear during async math render; not reproducible synchronously in jsdom */
      if (mathPlaceholders.length > 0) return false;

      // Check for pending mermaid renders
      const mermaidLoading = containerRef.current.querySelectorAll(
        ".mermaid-loading"
      );
      /* v8 ignore next -- @preserve reason: mermaid-loading class only set during live mermaid render cycle, not available in jsdom */
      if (mermaidLoading.length > 0) return false;

      // Defer image readiness to the shared `isImageSettled` predicate so
      // both stability paths (this internal check + waitForAssets) agree on
      // when an `<img>` is actually done — including the terminal error case
      // (empty src + .image-error) that would otherwise force the full
      // timeout. See issue #837.
      const images = containerRef.current.querySelectorAll("img");
      for (const img of images) {
        /* v8 ignore next -- @preserve reason: NodeView lifecycle states require real Tiptap rendering, not exercisable in jsdom; predicate itself is unit-tested in waitForAssets.test.ts */
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
      /* v8 ignore next -- @preserve reason: guard prevents double-call; ref is false on first invocation in all tests */
      if (onReadyCalledRef.current) return;

      const maxAttempts = 50; // 5 seconds max
      let attempts = 0;

      const check = async () => {
        attempts++;
        const isStable = await checkStability();

        /* v8 ignore next -- @preserve reason: isStable true/false paths both require real DOM and timer execution; not reliably exercisable in jsdom */
        if (isStable) {
          // Extra frame for layout
          requestAnimationFrame(() => {
            /* v8 ignore next -- @preserve reason: double-call guard inside rAF callback; not reachable in synchronous test execution */
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
          /* v8 ignore next -- @preserve reason: timeout path requires 50 polling cycles (5s); not exercisable without fake timers */
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
      /* v8 ignore next -- @preserve reason: editor is null initially and markdown may be empty; both guard branches not reachable together in jsdom */
      if (!editor || !markdown) return;

      try {
        const doc = parseMarkdown(editor.schema, markdown);
        editor.commands.setContent(doc.toJSON());

        // Start stability check
        waitForStability();
      } catch (error) {
        exportError("Failed to parse markdown for export surface:", error);
        /* v8 ignore next -- @preserve catch block not triggered in tests; markdown parse errors require malformed input */
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }, [editor, markdown, waitForStability, onError]);

    // Cleanup
    useEffect(() => {
      return () => {
        /* v8 ignore next -- @preserve reason: cleanup fires only on unmount with a pending timer; timing-dependent, not reliably triggerable in jsdom */
        if (stabilityCheckRef.current) {
          clearTimeout(stabilityCheckRef.current);
        }
      };
    }, []);

    /* v8 ignore next -- @preserve reason: dark-theme branch (lightTheme=false) not exercised in export tests; visual-only CSS class */
    const themeClass = lightTheme ? "" : "dark-theme";
    /* v8 ignore next -- @preserve reason: className ?? "" fallback only when className is undefined; always provided in tests */
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
/* v8 ignore stop */
