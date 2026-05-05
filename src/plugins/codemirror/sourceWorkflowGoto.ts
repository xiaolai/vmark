/**
 * Purpose: WI-B.2 — go-to-def for `uses:` lines. Cmd-Click (Mac) or
 *   Ctrl-Click (Linux/Win) on a `uses:` line that points at a
 *   workspace-local action or reusable workflow opens that target
 *   in a new tab. Remote refs (`actions/checkout@v4`, `docker://`)
 *   are ignored.
 *
 *   Pure helper `extractUsesAt` is unit-tested; the DOM event
 *   integration is in `gotoExtension()` and is smoke-tested live.
 *
 * @coordinates-with src/lib/ghaWorkflow/paths.ts — resolves the ref
 * @coordinates-with src/hooks/useOpenWorkflowTarget.ts — opens the tab
 * @module plugins/codemirror/sourceWorkflowGoto
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  isLocalUsesRef,
  resolveLocalUsesRef,
} from "@/lib/ghaWorkflow/paths";
import { openLocalFileInTab } from "@/hooks/useOpenWorkflowTarget";

const USES_LINE = /^(\s*-?\s*uses\s*:\s*)([^\s#]+.*)$/;

/**
 * Given source text and a cursor offset, return the `uses:` value if
 * the cursor is on a uses-line, with surrounding quotes / trailing
 * comment trimmed. Returns null otherwise.
 */
export function extractUsesAt(
  source: string,
  cursor: number,
): string | null {
  if (cursor < 0 || cursor > source.length) return null;
  // Find line bounds.
  let start = cursor;
  while (start > 0 && source[start - 1] !== "\n") start--;
  let end = cursor;
  while (end < source.length && source[end] !== "\n") end++;
  const line = source.slice(start, end);
  const m = line.match(USES_LINE);
  if (!m) return null;
  let value = m[2].trim();
  // Strip trailing # comment.
  const hashIdx = value.indexOf("#");
  if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
  // Strip surrounding quotes.
  if (
    (value.startsWith(`"`) && value.endsWith(`"`)) ||
    (value.startsWith(`'`) && value.endsWith(`'`))
  ) {
    value = value.slice(1, -1);
  }
  return value || null;
}

/**
 * Build the workspace root (POSIX absolute path) from the workflow
 * file. Heuristic: if the file is under `.github/workflows/`, the
 * workspace root is the directory containing `.github/`. Otherwise
 * we conservatively use the file's parent directory.
 */
function workspaceRootOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const ghIdx = norm.lastIndexOf("/.github/workflows/");
  if (ghIdx > 0) return norm.slice(0, ghIdx);
  return norm.slice(0, norm.lastIndexOf("/"));
}

export interface GotoExtensionContext {
  /** Absolute path of the editor's current file. */
  filePath: string;
  /** Window label this editor belongs to. */
  windowLabel: string;
  /** Optional callback for missing/load-failed targets (Codex MED-6). */
  onOpenFailure?: (reason: "missing" | "load-failed") => void;
}

/**
 * Build the goto-def extension scoped to a specific editor's file
 * + window. Codex audit HIGH-5 fix — previously read from global
 * tab state, which resolved local refs against the wrong repo in
 * multi-window sessions.
 */
export function gotoExtension(ctx: GotoExtensionContext): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      // Modifier-click only. macOS uses meta (Cmd); others use ctrl.
      const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgent);
      const isMod = isMac ? event.metaKey : event.ctrlKey;
      if (!isMod) return false;

      const pos = view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (pos == null) return false;
      const text = view.state.doc.toString();
      const ref = extractUsesAt(text, pos);
      if (!ref) return false;
      if (!isLocalUsesRef(ref)) return false;

      const wsRoot = workspaceRootOf(ctx.filePath);
      const resolved = resolveLocalUsesRef(ref, ctx.filePath, wsRoot);
      if (resolved.kind !== "action" && resolved.kind !== "workflow") {
        if (resolved.kind === "escaped" || resolved.kind === "invalid") {
          ctx.onOpenFailure?.("missing");
        }
        return false;
      }
      event.preventDefault();
      // Codex MED-6 fix: surface failures to the caller instead of
      // silently dropping them.
      void openLocalFileInTab(ctx.windowLabel, resolved.absPath).then(
        (result) => {
          if (!result.ok) {
            ctx.onOpenFailure?.(result.reason ?? "load-failed");
          }
        },
      );
      return true;
    },
  });
}
