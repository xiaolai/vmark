/**
 * Purpose: `vmark.selection.{get, set}` handlers — targeted edits on the
 *   user's current editor selection without paying the full-doc round-trip
 *   that `document.{read, write}` requires on large files.
 *
 *   Restored after the May 2026 pruning. See ADR-7 in
 *   `dev-docs/plans/20260504-mcp-pruning.md` for the cost analysis that
 *   motivated re-adding it.
 *
 * Key decisions:
 *   - Selection is view-state, so the request only operates on the
 *     currently focused editor. The `tabId` arg, when supplied, is
 *     verified to match the focused tab; mismatches return INVALID_TAB.
 *   - WYSIWYG (Tiptap) and source (CodeMirror) are both supported. The
 *     `mode` field in the response tells the AI which position space the
 *     `range` lives in (PM positions vs. character offsets).
 *   - In WYSIWYG, the response's `text` is the markdown serialization of
 *     the selected slice — same canonical representation the AI uses for
 *     `document.read`. `set` parses incoming markdown and replaces the
 *     selected range with the parsed nodes.
 *   - `set` operates on whatever the editor reports as the *current*
 *     selection at call time. If the user moved the cursor between
 *     `get` and `set`, the edit lands at the new position. The
 *     doc-level revision catches keystrokes; pure cursor movement is
 *     not arbitrated by the server.
 *
 * @coordinates-with stores/activeEditorStore.ts — focused editor instances
 * @coordinates-with stores/editorStore.ts — sourceMode flag picks the dispatcher
 * @coordinates-with stores/revisionStore.ts — optimistic concurrency
 * @coordinates-with stores/mcpCheckpointStore.ts — selection.set checkpoints
 * @module hooks/mcpBridge/v2/selection
 */

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CMView } from "@codemirror/view";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { useEditorStore } from "@/stores/editorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useMcpCheckpointStore } from "@/stores/mcpCheckpointStore";
import { appendCheckpoint } from "@/stores/mcpCheckpointPersistence";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import {
  parseMarkdown,
  serializeMarkdown,
} from "@/utils/markdownPipeline";
import {
  getSerializeOptions,
} from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { respond } from "../utils";
import { v2ErrorString } from "./types";
import type { DocumentKind, V2Error, V2ErrorCode } from "./types";

interface FocusedTab {
  tabId: string;
  filePath: string | null;
  content: string;
  kind: DocumentKind;
}

type SelectionMode = "wysiwyg" | "source";

function resolveKind(filePath: string | null, content: string): DocumentKind {
  if (looksLikeWorkflowPath(filePath ?? undefined)) return "yaml-workflow";
  if (isWorkflowYaml(content)) return "yaml-workflow";
  return "markdown";
}

/**
 * Resolve the focused tab. If `tabIdArg` is supplied it must match the
 * focused tab — selection is view-state and only the focused editor has
 * a live selection.
 */
function resolveFocusedTab(tabIdArg: string | undefined): FocusedTab | null {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();
  const windowLabel = getCurrentWindowLabel();
  const focusedTabId = tabState.activeTabId[windowLabel];
  if (!focusedTabId) return null;
  if (tabIdArg !== undefined && tabIdArg !== focusedTabId) return null;
  const doc = docState.documents[focusedTabId];
  if (!doc) return null;
  return {
    tabId: focusedTabId,
    filePath: doc.filePath,
    content: doc.content,
    kind: resolveKind(doc.filePath, doc.content),
  };
}

function structuredError(
  id: string,
  code: V2ErrorCode,
  message: string,
  extras: Partial<V2Error> = {},
): Promise<void> {
  const err: V2Error = { error: code, message, ...extras };
  return respond({ id, success: false, error: v2ErrorString(err) });
}

/**
 * Pick the editor for the focused tab, verifying the activeEditorStore
 * binding matches `focusedTabId`. Returns `null` for the editor field
 * when the active editor belongs to a different tab — the cross-tab
 * drift window where a stale ref from a previously-focused tab could
 * be treated as authoritative is closed by this check.
 */
function pickActiveEditor(focusedTabId: string): {
  mode: SelectionMode;
  tiptap: TiptapEditor | null;
  cm: CMView | null;
} {
  const sourceMode = useEditorStore.getState().sourceMode;
  const active = useActiveEditorStore.getState();
  if (sourceMode) {
    const view =
      active.activeSourceView && active.activeSourceTabId === focusedTabId
        ? active.activeSourceView
        : null;
    return { mode: "source", tiptap: null, cm: view };
  }
  const editor =
    active.activeWysiwygEditor && active.activeWysiwygTabId === focusedTabId
      ? active.activeWysiwygEditor
      : null;
  return { mode: "wysiwyg", tiptap: editor, cm: null };
}

/**
 * Heuristic — does this string look like it carries markdown structure?
 * Used to decide whether `selection.set` should round-trip through the
 * parser (markdown content) or insert as a literal text node (plain
 * content, where the parser would lose trailing whitespace).
 */
function looksLikeMarkdown(content: string): boolean {
  // Block-level structure: blank lines, headings, lists, blockquotes,
  // fences, thematic breaks, indented blocks.
  if (/\n\n/.test(content)) return true;
  if (/^(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|~~~|---|\t)/m.test(content)) {
    return true;
  }
  // Inline markers — strong/code/link/image/strikethrough.
  if (/(\*\*|__|`|\[[^\]]*\]\(|!\[|~~)/.test(content)) return true;
  // Single-marker emphasis — paired `*foo*`. Underscore is intentionally
  // not detected here: `snake_case` is a common false-positive in plain
  // text. Use `**bold**` or `*italic*` for emphasis intent.
  return /\*[^\s*][^*]*\*/.test(content);
}

/** Serialize a wrapped doc node, dropping the single trailing newline the
 * markdown serializer always adds as a doc terminator. Real hard breaks
 * inside the slice survive. */
function serializeAndTrimTerminator(
  schema: TiptapEditor["state"]["schema"],
  wrapped: ReturnType<TiptapEditor["state"]["schema"]["topNodeType"]["create"]>,
): string {
  const out = serializeMarkdown(schema, wrapped, getSerializeOptions());
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

/** Serialize the current PM selection slice as markdown. */
function getTiptapSelectionText(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return "";
  const slice = editor.state.doc.slice(from, to);
  const schema = editor.state.schema;
  const docType = schema.topNodeType;
  // A doc node cannot hold inline content directly. If the slice is
  // inline (text or marks), wrap it in a paragraph so the serializer
  // sees a valid tree.
  const firstChild = slice.content.firstChild;
  if (firstChild?.isInline && schema.nodes.paragraph) {
    const para = schema.nodes.paragraph.create(null, slice.content);
    return serializeAndTrimTerminator(schema, docType.create(null, [para]));
  }
  return serializeAndTrimTerminator(schema, docType.create(null, slice.content));
}

/** Replace the current PM selection with parsed markdown. */
function replaceTiptapSelection(editor: TiptapEditor, content: string): void {
  const { from, to } = editor.state.selection;
  const schema = editor.state.schema;
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  const sameTextblock = $from.sameParent($to) && $from.parent.isTextblock;

  let tr = editor.state.tr;

  if (content.length === 0) {
    tr = tr.deleteRange(from, to);
  } else if (sameTextblock && !looksLikeMarkdown(content)) {
    // Plain inline text: insert as a literal text node so trailing /
    // leading whitespace and naked characters round-trip exactly.
    tr = tr.replaceWith(from, to, schema.text(content));
  } else {
    const opts = getSerializeOptions();
    const parsed = parseMarkdown(schema, content, {
      preserveLineBreaks: opts.preserveLineBreaks,
    });
    // parseMarkdown wraps inline content in a paragraph. When the
    // selection is within a single textblock, that wrapper would split
    // the host paragraph — strip it. For block-spanning ranges, keep
    // the block structure.
    const onlyChild = parsed.content.firstChild;
    const insertion =
      sameTextblock &&
      parsed.content.childCount === 1 &&
      onlyChild?.isTextblock
        ? onlyChild.content
        : parsed.content;
    tr = tr.replaceWith(from, to, insertion);
  }

  editor.view.dispatch(tr.setMeta("addToHistory", true));
}

function recordSelectionCheckpoint(args: {
  tabId: string;
  filePath: string | null;
  contentBefore: string;
  revisionBefore: string;
  revisionAfter: string;
  selectedText: string;
  newText: string;
}): void {
  const id = useMcpCheckpointStore.getState().push({
    tabId: args.tabId,
    filePath: args.filePath,
    tool: "selection.set",
    description: describeSelectionSet(args.selectedText, args.newText),
    contentBefore: args.contentBefore,
    revisionBefore: args.revisionBefore,
    revisionAfter: args.revisionAfter,
  });
  const cp = useMcpCheckpointStore.getState().get(id);
  if (cp) void appendCheckpoint(cp);
}

function describeSelectionSet(before: string, after: string): string {
  const delta = after.length - before.length;
  const sign = delta >= 0 ? "+" : "−";
  return `Replaced selection (${sign}${Math.abs(delta)} chars, was ${before.length}, now ${after.length})`;
}

// ---------------------------------------------------------------------------
// vmark.selection.get
// ---------------------------------------------------------------------------

export async function handleSelectionGet(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const focused = resolveFocusedTab(tabIdArg);
    if (!focused) {
      await structuredError(id, "INVALID_TAB", "tabId could not be resolved");
      return;
    }
    const { mode, tiptap, cm } = pickActiveEditor(focused.tabId);
    if (mode === "wysiwyg" && (!tiptap || tiptap.isDestroyed)) {
      await structuredError(
        id,
        "NO_EDITOR",
        "No active WYSIWYG editor for the focused tab",
      );
      return;
    }
    if (mode === "source" && !cm) {
      await structuredError(
        id,
        "NO_EDITOR",
        "No active source editor for the focused tab",
      );
      return;
    }

    const revision = useRevisionStore.getState().getRevision();

    if (mode === "wysiwyg" && tiptap) {
      const { from, to } = tiptap.state.selection;
      const text = getTiptapSelectionText(tiptap);
      await respond({
        id,
        success: true,
        data: {
          text,
          isEmpty: from === to,
          range: { from, to },
          mode,
          kind: focused.kind,
          tabId: focused.tabId,
          revision,
        },
      });
      return;
    }

    if (mode === "source" && cm) {
      const { from, to } = cm.state.selection.main;
      const text = from === to ? "" : cm.state.sliceDoc(from, to);
      await respond({
        id,
        success: true,
        data: {
          text,
          isEmpty: from === to,
          range: { from, to },
          mode,
          kind: focused.kind,
          tabId: focused.tabId,
          revision,
        },
      });
      return;
    }
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// vmark.selection.set
// ---------------------------------------------------------------------------

export async function handleSelectionSet(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    if (typeof args.content !== "string") {
      await structuredError(id, "INTERNAL", "content must be a string");
      return;
    }
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const expectedRevision =
      typeof args.expected_revision === "string"
        ? args.expected_revision
        : undefined;

    const focused = resolveFocusedTab(tabIdArg);
    if (!focused) {
      await structuredError(id, "INVALID_TAB", "tabId could not be resolved");
      return;
    }
    const { mode, tiptap, cm } = pickActiveEditor(focused.tabId);
    if (mode === "wysiwyg" && (!tiptap || tiptap.isDestroyed)) {
      await structuredError(
        id,
        "NO_EDITOR",
        "No active WYSIWYG editor for the focused tab",
      );
      return;
    }
    if (mode === "source" && !cm) {
      await structuredError(
        id,
        "NO_EDITOR",
        "No active source editor for the focused tab",
      );
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(expectedRevision)
    ) {
      await structuredError(id, "STALE", "Document has changed since the last read", {
        current_revision: revisionStore.getRevision(),
      });
      return;
    }

    const revisionBefore = revisionStore.getRevision();

    if (mode === "wysiwyg" && tiptap) {
      const selectedText = getTiptapSelectionText(tiptap);
      // Capture contentBefore from the LIVE editor, not focused.content
      // (which came from documentStore). The Tiptap → store sync is
      // RAF-debounced, so the store can lag the editor by a frame after
      // recent keystrokes. Reading from the editor avoids snapshotting
      // stale content into the checkpoint.
      const opts = getSerializeOptions();
      const contentBefore = serializeMarkdown(
        tiptap.state.schema,
        tiptap.state.doc,
        opts,
      );
      replaceTiptapSelection(tiptap, args.content);
      // Mirror the new doc into the store synchronously. In production
      // the React onUpdate handler also runs (idempotent — same value)
      // and revisionTracker bumps via the transaction listener. Doing
      // the work inline keeps the handler self-contained and testable.
      const contentAfter = serializeMarkdown(
        tiptap.state.schema,
        tiptap.state.doc,
        opts,
      );
      useDocumentStore.getState().setContent(focused.tabId, contentAfter);
      revisionStore.updateRevision();
      const revisionAfter = revisionStore.getRevision();
      if (contentAfter !== contentBefore) {
        recordSelectionCheckpoint({
          tabId: focused.tabId,
          filePath: focused.filePath,
          contentBefore,
          revisionBefore,
          revisionAfter,
          selectedText,
          newText: args.content,
        });
      }
      await respond({
        id,
        success: true,
        data: {
          revision: revisionAfter,
          replaced_chars: selectedText.length,
        },
      });
      return;
    }

    if (mode === "source" && cm) {
      // Read contentBefore from the LIVE CM view to avoid the same
      // store-staleness window as the WYSIWYG path.
      const contentBefore = cm.state.doc.toString();
      const { from, to } = cm.state.selection.main;
      const selectedText = from === to ? "" : cm.state.sliceDoc(from, to);
      cm.dispatch({
        changes: { from, to, insert: args.content },
        selection: { anchor: from + args.content.length },
      });
      // Mirror the new text into the store synchronously. The
      // SourceEditor component's CM updateListener also runs in
      // production — idempotent because the content matches.
      const contentAfter = cm.state.doc.toString();
      useDocumentStore.getState().setContent(focused.tabId, contentAfter);
      revisionStore.updateRevision();
      const revisionAfter = revisionStore.getRevision();
      if (contentAfter !== contentBefore) {
        recordSelectionCheckpoint({
          tabId: focused.tabId,
          filePath: focused.filePath,
          contentBefore,
          revisionBefore,
          revisionAfter,
          selectedText,
          newText: args.content,
        });
      }
      await respond({
        id,
        success: true,
        data: {
          revision: revisionAfter,
          replaced_chars: selectedText.length,
        },
      });
      return;
    }
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
