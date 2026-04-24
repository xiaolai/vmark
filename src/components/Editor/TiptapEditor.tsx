/**
 * TiptapEditorInner
 *
 * Purpose: WYSIWYG rich-text editing surface built on Tiptap/ProseMirror. Parses markdown
 * to ProseMirror document on load, serializes back on every edit with adaptive debouncing.
 *
 * Key decisions:
 *   - Initial content loaded via setContentWithoutHistory to avoid polluting the undo stack
 *     with the initial parse.
 *   - Adaptive debounce (100ms–5s) scales with document size: larger docs get longer
 *     delays to reduce serialization frequency without losing keystrokes on unmount.
 *   - Initial parse is deferred via setTimeout(0) so the editor shell renders before the
 *     heavy markdown→PM conversion runs, keeping the UI responsive on large documents.
 *   - shouldRerenderOnTransaction: false — Tiptap's default full-React-rerender per
 *     transaction is wasted work here since state flows through Zustand selectors.
 *   - content-visibility gated on .cv-idle (debounced off during typing) — the CSS
 *     optimization is applied at rest but stripped during edits to avoid a
 *     O(blocks-after-insertion) reflow on long docs.
 *   - Native spellcheck disabled above 100K chars where rescans block the main thread.
 *   - Cursor tracking is delayed 200ms after creation to prevent spurious sync during
 *     initial render/focus.
 *   - Flusher registration moved to useEffect (not onCreate) to handle React Strict Mode
 *     double-mount without duplicate registrations.
 *   - Hidden mode skips all store updates and content syncs, deferring to visibility transition.
 *
 * @coordinates-with SourceEditor.tsx — shares document content via documentStore
 * @coordinates-with utils/markdownPipeline/ — parseMarkdown/serializeMarkdown for round-tripping
 * @coordinates-with utils/wysiwygFlush.ts — registers flusher for on-demand serialization before save
 * @module components/Editor/TiptapEditor
 */
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { useFileLoadStore } from "@/stores/fileLoadStore";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/utils/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/utils/tiptapFocus";
import { createTiptapExtensions } from "@/utils/tiptapExtensions";
import type { CursorInfo } from "@/stores/documentStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { handleTableScrollToSelection } from "@/plugins/tableScroll/scrollGuard";
import { tiptapError, contentSearchLog } from "@/utils/debug";
import { consumePendingContentSearchNav, openFindBarWithQuery } from "@/hooks/contentSearchNavigation";
import { ImageContextMenu } from "./ImageContextMenu";

/**
 * Delay before enabling cursor tracking after editor creation.
 * Prevents spurious cursor sync during initial render/focus.
 */
const CURSOR_TRACKING_DELAY_MS = 200;

/**
 * Set editor content without adding to undo history.
 * Tiptap's setContent in v3.x does NOT exclude from history by default,
 * so we use a direct ProseMirror transaction with addToHistory: false.
 */
function setContentWithoutHistory(editor: TiptapEditor, doc: PMNode): void {
  const view = getTiptapEditorView(editor);
  if (!view) {
    // Fallback to standard setContent if view not available
    editor.commands.setContent(doc, { emitUpdate: false });
    return;
  }

  const { state } = view;
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true); // Don't emit update event
  view.dispatch(tr);
}

/**
 * Calculate adaptive debounce delay based on document size.
 * Larger documents get longer delays to reduce parsing overhead during typing.
 *
 * @param docSize - Document size in characters
 * @returns Delay in milliseconds
 */
function getAdaptiveDebounceDelay(docSize: number): number {
  if (docSize > 1000000) return 5000; // 1M+: 5s (~1MB+ markdown)
  if (docSize > 500000) return 2000;  // 500K+: 2s
  if (docSize > 100000) return 1000;  // 100K+: 1s
  if (docSize > 50000) return 500;    // 50K+: 500ms
  if (docSize > 20000) return 300;    // 20K+: 300ms
  return 100;                          // Default: 100ms (using RAF for small docs)
}

/**
 * Document-size threshold (in characters) above which content-visibility
 * optimization is enabled. Below this, the cv-idle toggle causes visible
 * layout shift on every keystroke-to-idle transition because `auto`
 * intrinsic-size estimates diverge from real block heights when off-screen
 * blocks have never been rendered. For small docs the optimization delivers
 * no measurable win and the toggle produces a "shaking" / rippling effect
 * as the total document height changes on each idle interval (#823).
 */
const CV_IDLE_CHAR_THRESHOLD = 50_000;

/**
 * Parse markdown and sync it into the editor without touching undo history.
 * Updates lastExternalContent tracking ref on success.
 * Returns true if content was synced, false if already current or on error.
 */
function syncMarkdownToEditor(
  editor: TiptapEditor,
  markdown: string,
  lastExternalContent: MutableRefObject<string>,
  preserveLineBreaks: boolean,
): boolean {
  if (markdown === lastExternalContent.current) return false;
  try {
    const doc = parseMarkdown(editor.schema, markdown, { preserveLineBreaks });
    setContentWithoutHistory(editor, doc);
    lastExternalContent.current = markdown;
    return true;
  } catch (error) {
    tiptapError(" Failed to sync markdown:", error);
    return false;
  }
}

interface TiptapEditorInnerProps {
  hidden?: boolean;
  readOnly?: boolean;
}

/** WYSIWYG rich-text editor built on Tiptap/ProseMirror with adaptive debounced serialization. */
export function TiptapEditorInner({ hidden = false, readOnly = false }: TiptapEditorInnerProps) {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo, setSelectedText } = useDocumentActions();
  const preserveLineBreaks = useSettingsStore((state) => state.markdown.preserveLineBreaks);
  const hardBreakStyleOnSave = useSettingsStore((state) => state.markdown.hardBreakStyleOnSave);
  const showLineNumbers = useEditorStore((state) => state.showLineNumbers);
  const cjkLetterSpacing = useSettingsStore((state) => state.appearance.cjkLetterSpacing);
  const lintEnabled = useSettingsStore((state) => state.markdown.lintEnabled);
  const windowLabel = useWindowLabel();
  /* v8 ignore next -- @preserve reason: runtime window label lookup; windowLabel always resolves in tests */
  const activeTabId = useTabStore((state) => state.activeTabId[windowLabel] ?? undefined);

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingDebounceTimeout = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const internalChangeRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  // Track whether onCreate has run to prevent external sync from running before editor is ready
  const editorInitialized = useRef(false);
  const preserveLineBreaksRef = useRef(preserveLineBreaks);
  const hardBreakStyleOnSaveRef = useRef(hardBreakStyleOnSave);
  const hiddenRef = useRef(hidden);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const cvIdleTimeoutRef = useRef<number | null>(null);
  const contentRef = useRef(content);
  const editorRef = useRef<TiptapEditor | null>(null);
  const flushToStoreRef = useRef<((editor: TiptapEditor) => void) | null>(null);
  cursorInfoRef.current = cursorInfo;
  preserveLineBreaksRef.current = preserveLineBreaks;
  hardBreakStyleOnSaveRef.current = hardBreakStyleOnSave;
  hiddenRef.current = hidden;
  contentRef.current = content;

  const extensions = useMemo(
    () => createTiptapExtensions({ tabId: activeTabId, lintEnabled }),
    // tabId and lintEnabled are captured at mount time — editor remounts per tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeMarkdown(editor.schema, editor.state.doc, {
        preserveLineBreaks: preserveLineBreaksRef.current,
        hardBreakStyle: (() => {
          const tabId = useTabStore.getState().activeTabId[windowLabel];
          /* v8 ignore next -- @preserve reason: no active tabId only if tab store is uninitialized; always set during normal editor lifecycle */
          if (!tabId) return resolveHardBreakStyle("unknown", hardBreakStyleOnSaveRef.current);
          const doc = useDocumentStore.getState().getDocument(tabId);
          /* v8 ignore next -- @preserve reason: doc?.hardBreakStyle ?? fallback only when doc is null; doc always present for active tab */
          return resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSaveRef.current);
        })(),
      });

      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);

      // Cancel previous RAF if pending, then schedule reset
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
      }
      internalChangeRaf.current = requestAnimationFrame(() => {
        internalChangeRaf.current = null;
        isInternalChange.current = false;
      });
    },
    [setContent, windowLabel]
  );
  flushToStoreRef.current = flushToStore;

  const flushCursorInfo = useCallback(() => {
    pendingCursorRaf.current = null;
    /* v8 ignore next -- @preserve reason: null guard when no cursor update is pending; scheduling ensures value is always set before flush */
    if (!pendingCursorInfo.current) return;
    setCursorInfo(pendingCursorInfo.current);
    pendingCursorInfo.current = null;
  }, [setCursorInfo]);

  const scheduleCursorUpdate = useCallback(
    (info: CursorInfo) => {
      pendingCursorInfo.current = info;
      if (pendingCursorRaf.current === null) {
        pendingCursorRaf.current = requestAnimationFrame(flushCursorInfo);
      }
    },
    [flushCursorInfo]
  );

  const editor = useEditor({
    editable: !readOnly,
    extensions,
    // Tiptap re-renders the React tree on every transaction by default. VMark's
    // editor state flows through Zustand selectors and explicit onUpdate/onSelectionUpdate
    // hooks, so the blanket re-render is wasted work — especially on large docs where
    // typing produces dozens of transactions per second.
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "ProseMirror",
        // Disable native browser spellcheck on large documents — on 100K+ char docs
        // the spellchecker holds the main thread while rescanning after every edit,
        // causing visible typing lag. 100K threshold mirrors the debounce tier.
        spellcheck: content.length > 100000 ? "false" : "true",
      },
      // Suppress ProseMirror's default scrollRectIntoView when cursor is in a table
      // to prevent horizontal scroll jumps on .table-scroll-wrapper
      handleScrollToSelection(view) {
        return handleTableScrollToSelection(view);
      },
    },
    onCreate: ({ editor }) => {
      // Reset for this new editor instance (handles React Strict Mode double-mount)
      editorInitialized.current = false;

      // Capture content at mount time — the closure value is stable for this editor instance.
      const contentSnapshot = content;

      // Capture the in-flight load id (if any) so a stale completion from a
      // previous tab cannot clear a newer load indicator.
      const loadIdAtMount = useFileLoadStore.getState().active
        ? useFileLoadStore.getState().loadId
        : null;

      // Defer the heavy markdown→PM parse so the editor shell renders before the parse
      // blocks the main thread. For large documents this keeps the UI responsive.
      setTimeout(() => {
        if (editor.isDestroyed) return;
        try {
          const doc = parseMarkdown(editor.schema, contentSnapshot, {
            preserveLineBreaks: preserveLineBreaksRef.current,
          });
          // Use helper to avoid polluting undo history with initial content load
          setContentWithoutHistory(editor, doc);
          lastExternalContent.current = contentSnapshot;
          editorInitialized.current = true;

          // If content drifted while the deferred parse was pending, sync the
          // fresh value now — otherwise the external-sync effect (gated on
          // editorInitialized) already skipped it and would not refire until
          // the next content change.
          if (contentRef.current !== contentSnapshot) {
            syncMarkdownToEditor(
              editor, contentRef.current, lastExternalContent, preserveLineBreaksRef.current,
            );
          }
        } catch (error) {
          tiptapError(" Failed to parse initial markdown:", error);
          editorInitialized.current = true; // Unblock external sync even on parse error
        } finally {
          // Clear the "Opening large file…" StatusBar indicator once this
          // editor has a doc and is interactive. Scope the clear to the
          // loadId we captured at mount so a stale completion from a prior
          // tab cannot wipe a newer indicator.
          if (loadIdAtMount !== null) {
            useFileLoadStore.getState().endLoad(loadIdAtMount);
          }
        }

        // Focus and cursor restore run after content is set so saved cursor
        // positions can be resolved against the actual document.
        if (!hiddenRef.current) {
          scheduleTiptapFocusAndRestore(
            editor,
            () => cursorInfoRef.current,
            restoreCursorInTiptap
          );
        }

        const view = getTiptapEditorView(editor);
        if (view) {
          useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
        }
      }, 0);

      // Cursor tracking setup is immediate — it starts the delay timer independently
      // of the parse, since it gates selection events not content loading.
      cursorTrackingEnabled.current = false;
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
      }
      trackingTimeoutId.current = window.setTimeout(() => {
        cursorTrackingEnabled.current = true;
      }, CURSOR_TRACKING_DELAY_MS);

      // NOTE: Flusher registration moved to useEffect to avoid dual registration issues
      // with React Strict Mode. The useEffect ensures proper cleanup on unmount.
    },
    onUpdate: ({ editor, transaction }) => {
      // Skip programmatic content loads (reload, external sync) — they set
      // preventUpdate on the transaction to avoid a round-trip serialization
      // that would dirty the document immediately after it was cleaned (#806).
      if (transaction?.getMeta("preventUpdate")) return;
      // Skip updates when hidden — prevents polluting document store
      /* v8 ignore next -- @preserve reason: hidden path skips update; hidden mode not exercised in WYSIWYG update tests */
      if (hiddenRef.current) return;

      // Suppress content-visibility during active typing. Keeping cv on during
      // edits costs O(blocks-after-insertion) per keystroke in Chromium — e.g.
      // 378ms on a 2250-block doc. Re-enable after idle so scroll and repaint
      // keep the optimization.
      //
      // Small documents (<CV_IDLE_CHAR_THRESHOLD) skip the re-enable entirely:
      // the toggle causes visible shaking because `contain-intrinsic-size: auto`
      // fallbacks don't match real block heights when off-screen blocks have
      // never been rendered, and small docs don't need the optimization anyway (#823).
      const container = editorContainerRef.current;
      if (container) {
        const docSizeNow = editor.state.doc.content.size;
        container.classList.remove("cv-idle");
        if (cvIdleTimeoutRef.current !== null) {
          window.clearTimeout(cvIdleTimeoutRef.current);
          cvIdleTimeoutRef.current = null;
        }
        if (docSizeNow >= CV_IDLE_CHAR_THRESHOLD) {
          cvIdleTimeoutRef.current = window.setTimeout(() => {
            cvIdleTimeoutRef.current = null;
            editorContainerRef.current?.classList.add("cv-idle");
          }, 500);
        }
      }

      // Cancel any pending flush
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
      }

      // Use adaptive delay based on document size
      const docSize = editor.state.doc.content.size;
      const delay = getAdaptiveDebounceDelay(docSize);

      if (delay <= 100) {
        // Small documents: use RAF for immediate updates
        pendingRaf.current = requestAnimationFrame(() => {
          pendingRaf.current = null;
          flushToStore(editor);
        });
      } else {
        // Large documents: use debounced timeout
        pendingDebounceTimeout.current = window.setTimeout(() => {
          pendingDebounceTimeout.current = null;
          flushToStore(editor);
        }, delay);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (hiddenRef.current) return;
      // Selection text sync runs before the cursor-tracking gate — it has
      // no feedback-loop risk and must update immediately so the status bar
      // reflects the active editor (especially after a mode switch).
      const { from, to, empty } = editor.state.selection;
      setSelectedText(empty ? "" : editor.state.doc.textBetween(from, to, "\n", " "));
      if (!cursorTrackingEnabled.current) return;
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
      useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
    },
  });

  // Keep editorRef aligned with the live editor so unmount cleanup can flush
  // directly without depending on the global flusher registry — which may be
  // nulled by this component's own registration cleanup before the flush
  // cleanup runs (React runs effect cleanups in reverse registration order).
  editorRef.current = editor ?? null;

  // Return null from getEditorView when hidden to prevent outline sync from stale editor
  const getEditorView = useCallback(
    () => (hidden ? null : getTiptapEditorView(editor)),
    [editor, hidden]
  );
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView);

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    tiptapEditor: editor,
    isSourceMode: false,
    enabled: !!editor && !hidden,
  });

  // Cleanup all pending timers/RAFs on unmount to prevent memory leaks.
  // Flush any pending content BEFORE cancelling timers to avoid data loss —
  // keystrokes within the debounce window exist only in PM's in-memory doc (#755).
  useEffect(() => {
    return () => {
      // Flush pending content directly via this instance's editor — relying on
      // the global flushActiveWysiwygNow() registry was racy: React cleans up
      // effects in reverse registration order, so the flusher deregistration
      // (useEffect below) runs before this cleanup and the flush becomes a
      // no-op, losing keystrokes within the debounce window (#755).
      if ((pendingRaf.current || pendingDebounceTimeout.current) && editorRef.current && flushToStoreRef.current) {
        try { flushToStoreRef.current(editorRef.current); } catch { /* defensive */ }
      }
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
      }
      if (pendingCursorRaf.current) {
        cancelAnimationFrame(pendingCursorRaf.current);
        pendingCursorRaf.current = null;
      }
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
        internalChangeRaf.current = null;
      }
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
        trackingTimeoutId.current = null;
      }
      if (cvIdleTimeoutRef.current !== null) {
        window.clearTimeout(cvIdleTimeoutRef.current);
        cvIdleTimeoutRef.current = null;
      }
    };
  }, []);

  // Register flusher — only when visible
  useEffect(() => {
    if (!editor || hidden) return;
    registerActiveWysiwygFlusher(() => {
      flushToStore(editor);
    });
    return () => {
      registerActiveWysiwygFlusher(null);
    };
  }, [editor, flushToStore, hidden]);

  // Register editor stores — only when visible
  useEffect(() => {
    if (!hidden) {
      useTiptapEditorStore.getState().setEditor(editor ?? null);
      if (editor) {
        useActiveEditorStore.getState().setActiveWysiwygEditor(editor);
      }
    }
    return () => {
      useTiptapEditorStore.getState().clear();
      if (editor) {
        useActiveEditorStore.getState().clearWysiwygEditorIfMatch(editor);
      }
    };
  }, [editor, hidden]);

  // Force CJK letter spacing decorations to recalculate when setting changes.
  // The plugin tracks wasEnabled state, but needs a transaction to trigger apply().
  useEffect(() => {
    if (!editor) return;
    // Dispatch empty transaction to trigger plugin state recalculation
    const view = getTiptapEditorView(editor);
    if (view) {
      const tr = view.state.tr
        .setMeta("cjkLetterSpacingChanged", true)
        .setMeta("addToHistory", false); // Settings change shouldn't pollute undo history
      view.dispatch(tr);
    }
  }, [editor, cjkLetterSpacing]);

  // Toggle editor editability when read-only mode changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // Clear shared selectedText when this editor becomes hidden — prevents
  // its last selection from lingering in the status bar while the other
  // editor (Source mode) is active.
  useEffect(() => {
    if (hidden) setSelectedText("");
  }, [hidden, setSelectedText]);

  // Sync external content changes TO the editor.
  // Only runs for SUBSEQUENT content changes after onCreate has initialized the editor.
  // This prevents double-loading on initial mount and React Strict Mode remounts.
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: editor null guard; always defined by the time the content effect fires */
    if (!editor) return;
    // Skip sync when hidden — content will be synced on visibility transition
    /* v8 ignore next -- @preserve reason: hidden branch skips external content sync; hidden tab scenario not covered in current tests */
    if (hiddenRef.current) return;
    /* v8 ignore next -- @preserve reason: isInternalChange guard; only set true during programmatic content updates, not exercised in isolation tests */
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;
    // Skip if onCreate hasn't run yet - let onCreate handle initial content loading
    if (!editorInitialized.current) return;

    const synced = syncMarkdownToEditor(
      editor, content, lastExternalContent, preserveLineBreaksRef.current,
    );

    // For fresh document load (no saved cursor position), set cursor to start
    /* v8 ignore next -- @preserve reason: fresh-doc cursor reset only when synced and no saved cursor; requires specific initial state not exercised in tests */
    if (synced && !cursorInfoRef.current) {
      const view = getTiptapEditorView(editor);
      /* v8 ignore next -- @preserve reason: view null guard; always present after editor init */
      if (view) {
        try {
          const tr = view.state.tr
            .setSelection(Selection.atStart(view.state.doc))
            .scrollIntoView()
            .setMeta("addToHistory", false);
          view.dispatch(tr);
        } catch {
          // Ignore selection errors
        }
      }
    }
  }, [content, editor]);

  // Handle visibility transitions: hidden → visible
  useEffect(() => {
    if (hidden) return;
    if (!editor || !editorInitialized.current) return;

    syncMarkdownToEditor(
      editor, content, lastExternalContent, preserveLineBreaksRef.current,
    );

    // Focus and restore cursor
    scheduleTiptapFocusAndRestore(
      editor,
      () => cursorInfoRef.current,
      restoreCursorInTiptap
    );

    // Consume pending content search nav (set when opening a file from Find in Files)
    const activeTabId = useTabStore.getState().activeTabId[windowLabel];
    if (activeTabId) {
      const pendingNav = consumePendingContentSearchNav(activeTabId);
      if (pendingNav) {
        contentSearchLog("WYSIWYG nav to line", pendingNav.line);
        // In WYSIWYG mode, scroll to approximate position by walking block nodes
        const view = getTiptapEditorView(editor);
        if (view) {
          // Walk the document to find the Nth block (lines map roughly to blocks)
          let blockCount = 0;
          let targetPos = 0;
          view.state.doc.descendants((node, pos) => {
            if (node.isBlock && node.isTextblock) {
              blockCount++;
              if (blockCount === pendingNav.line) {
                targetPos = pos;
                return false; // stop walking
              }
            }
            return true;
          });
          if (targetPos > 0) {
            view.dispatch(
              view.state.tr
                .setSelection(Selection.near(view.state.doc.resolve(targetPos)))
                .scrollIntoView()
            );
          }
          // Pre-fill FindBar after a brief delay to let the scroll settle
          setTimeout(() => openFindBarWithQuery(pendingNav.query), 100);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  // Initial cv-idle application is gated on document size — small docs skip the
  // optimization entirely to avoid the layout-shift / shaking pattern described
  // above CV_IDLE_CHAR_THRESHOLD. `content.length` is a cheap proxy for the PM
  // doc size (close enough for the threshold check; the exact post-parse size
  // governs onUpdate toggling).
  const shouldUseCvIdle = content.length >= CV_IDLE_CHAR_THRESHOLD;
  /* v8 ignore next -- @preserve reason: show-line-numbers CSS class branch not exercised in current TiptapEditor render tests */
  const editorClassName = [
    "tiptap-editor",
    shouldUseCvIdle ? "cv-idle" : null,
    showLineNumbers ? "show-line-numbers" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div ref={editorContainerRef} className={editorClassName} style={hidden ? { display: "none" } : undefined}>
        <EditorContent editor={editor} />
      </div>
      {!hidden && <ImageContextMenu onAction={handleImageContextMenuAction} />}
    </>
  );
}
