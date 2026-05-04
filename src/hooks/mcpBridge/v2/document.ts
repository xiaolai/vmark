/**
 * Purpose: `vmark.document.{read, write, transform}` handlers — the
 *   read/write spine of the pruned MCP surface.
 *
 *   `read` returns full content + a revision token. `write` replaces
 *   full content (optimistic-concurrency-protected via expected_revision).
 *   `transform` runs the deterministic CJK rewriter — kept because CJK
 *   rules are too nuanced for AI prose to reimplement reliably.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-1, ADR-2, ADR-4.
 *
 * Key decisions:
 *   - Full-content write, not diff. Correctness first; if large-doc
 *     cost ever proves a real problem, add `apply_diff` later.
 *   - `expected_revision` is optional. If absent, we still allow the
 *     write — useful for greenfield "AI types from scratch" flows. When
 *     present, mismatch returns STALE.
 *   - `transform` operates on the whole document, not a selection.
 *
 * @coordinates-with stores/revisionStore.ts — current revision + isCurrentRevision
 * @coordinates-with lib/cjkFormatter — formatMarkdown for transform
 * @coordinates-with utils/markdownPipeline.ts — parseMarkdown / serializeMarkdown
 * @coordinates-with stores/documentStore.ts — content + dirty state
 * @coordinates-with stores/tabStore.ts — tab → window resolution
 * @module hooks/mcpBridge/v2/document
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { formatMarkdown } from "@/lib/cjkFormatter";
import { parseMarkdown } from "@/utils/markdownPipeline";
import {
  getSerializeOptions,
  shouldPreserveTwoSpaceBreaks,
} from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { respond } from "../utils";
import { v2ErrorString } from "./types";
import type { DocumentKind, V2Error } from "./types";
import { HALF_TO_FULL } from "../cjkHandlers";

interface ResolvedTab {
  tabId: string;
  windowLabel: string;
  filePath: string | null;
  content: string;
  dirty: boolean;
  kind: DocumentKind;
}

function resolveTab(tabIdArg: string | undefined): ResolvedTab | null {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();

  let tabId: string;
  let windowLabel: string;

  if (tabIdArg) {
    const owner = Object.entries(tabState.tabs).find(([, list]) =>
      list.some((t) => t.id === tabIdArg),
    );
    if (!owner) return null;
    tabId = tabIdArg;
    windowLabel = owner[0];
  } else {
    windowLabel = getCurrentWindowLabel();
    const active = tabState.activeTabId[windowLabel];
    if (!active) return null;
    tabId = active;
  }

  const doc = docState.documents[tabId];
  if (!doc) return null;

  const content = doc.content;
  const filePath = doc.filePath;
  const kind: DocumentKind = looksLikeWorkflowPath(filePath ?? undefined)
    ? "yaml-workflow"
    : isWorkflowYaml(content)
      ? "yaml-workflow"
      : "markdown";

  return {
    tabId,
    windowLabel,
    filePath,
    content,
    dirty: doc.isDirty,
    kind,
  };
}

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

/**
 * Replace document content. Returns the new revision on success or a
 * structured V2Error on failure. Does NOT call `respond` — callers
 * decide how to package the result.
 */
function writeContent(
  tabId: string,
  content: string,
  kind: DocumentKind,
): { revision: string } | V2Error {
  const docState = useDocumentStore.getState();
  const revisionStore = useRevisionStore.getState();

  docState.setContent(tabId, content);

  // For Markdown tabs, also re-render the Tiptap doc so the WYSIWYG
  // editor stays in sync. Editor transactions automatically bump the
  // revision via revisionTracker. For non-Markdown (workflow YAML)
  // tabs, the editor isn't bound — bump the revision manually.
  const editor = useTiptapEditorStore.getState().editor;
  if (editor && kind === "markdown") {
    try {
      const serializeOpts = getSerializeOptions();
      const newDoc = parseMarkdown(editor.schema, content, {
        preserveLineBreaks: serializeOpts.preserveLineBreaks,
      });
      const view = editor.view;
      const tr = view.state.tr
        .replaceWith(0, view.state.doc.content.size, newDoc.content)
        .setMeta("addToHistory", true);
      view.dispatch(tr);
    } catch {
      // Parser rejected — doc store already updated; force-bump
      // revision so callers see a fresh token.
      revisionStore.updateRevision();
    }
  } else {
    revisionStore.updateRevision();
  }

  return { revision: revisionStore.getRevision() };
}

/**
 * Handle `vmark.document.read`. Args: `{tabId?: string}`.
 */
export async function handleDocumentRead(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }
    const revision = useRevisionStore.getState().getRevision();
    await respond({
      id,
      success: true,
      data: {
        content: resolved.content,
        revision,
        filePath: resolved.filePath,
        kind: resolved.kind,
        dirty: resolved.dirty,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.document.write`.
 *
 * Args: `{tabId?, content: string, expected_revision?: string}`.
 */
export async function handleDocumentWrite(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    if (typeof args.content !== "string") {
      await structuredError(id, {
        error: "INTERNAL",
        message: "content must be a string",
      });
      return;
    }
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const expectedRevision =
      typeof args.expected_revision === "string"
        ? args.expected_revision
        : undefined;

    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(expectedRevision)
    ) {
      await structuredError(id, {
        error: "STALE",
        message: "Document has changed since the last read",
        current_revision: revisionStore.getRevision(),
      });
      return;
    }

    const result = writeContent(resolved.tabId, args.content, resolved.kind);
    if ("error" in result) {
      await structuredError(id, result);
      return;
    }
    await respond({ id, success: true, data: result });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const TRANSFORM_KINDS = [
  "cjk-format",
  "cjk-spacing",
  "cjk-punctuation",
] as const;
type TransformKind = (typeof TRANSFORM_KINDS)[number];

function isTransformKind(value: unknown): value is TransformKind {
  return (
    typeof value === "string" &&
    (TRANSFORM_KINDS as readonly string[]).includes(value)
  );
}

const CJK_RE = "[一-鿿぀-ゟ゠-ヿ가-힯]";

function applyTransform(kind: TransformKind, content: string): string {
  switch (kind) {
    case "cjk-format": {
      const config = useSettingsStore.getState().cjkFormatting;
      const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
      return formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });
    }
    case "cjk-spacing": {
      // Add spacing between CJK and Latin/digits in both directions.
      // Idempotent — only adds a single space; never doubles.
      return content
        .replace(new RegExp(`(${CJK_RE})([A-Za-z0-9])`, "g"), "$1 $2")
        .replace(new RegExp(`([A-Za-z0-9])(${CJK_RE})`, "g"), "$1 $2");
    }
    case "cjk-punctuation": {
      // Convert ASCII punctuation adjacent to CJK characters to its
      // full-width form. Pure ASCII contexts are left alone.
      let result = content;
      for (const [half, full] of Object.entries(HALF_TO_FULL)) {
        const escaped = half.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result
          .replace(new RegExp(`(${CJK_RE})${escaped}`, "g"), `$1${full}`)
          .replace(new RegExp(`${escaped}(${CJK_RE})`, "g"), `${full}$1`);
      }
      return result;
    }
  }
}

/**
 * Handle `vmark.document.transform`.
 *
 * Args: `{tabId?, kind: "cjk-format" | "cjk-spacing" | "cjk-punctuation",
 * expected_revision?}`.
 */
export async function handleDocumentTransform(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    if (!isTransformKind(args.kind)) {
      await structuredError(id, {
        error: "INTERNAL",
        message: `kind must be one of: ${TRANSFORM_KINDS.join(", ")}`,
      });
      return;
    }
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const expectedRevision =
      typeof args.expected_revision === "string"
        ? args.expected_revision
        : undefined;

    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(expectedRevision)
    ) {
      await structuredError(id, {
        error: "STALE",
        message: "Document has changed since the last read",
        current_revision: revisionStore.getRevision(),
      });
      return;
    }

    const transformed = applyTransform(args.kind, resolved.content);
    if (transformed === resolved.content) {
      await respond({
        id,
        success: true,
        data: { revision: revisionStore.getRevision() },
      });
      return;
    }

    const result = writeContent(resolved.tabId, transformed, resolved.kind);
    if ("error" in result) {
      await structuredError(id, result);
      return;
    }
    await respond({ id, success: true, data: result });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
