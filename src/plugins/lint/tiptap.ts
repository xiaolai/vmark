/**
 * Lint Tiptap Extension (WYSIWYG)
 *
 * Purpose: Wraps the ProseMirror lint plugin as a Tiptap extension with
 * reactive re-decoration when lintStore diagnostics change.
 *
 * Key decisions:
 *   - Uses configurable tabId to scope diagnostics per tab.
 *   - Subscribes to lintStore to re-dispatch when results arrive.
 *   - Subscribes to settingsStore so toggling markdown.lintEnabled takes
 *     effect live: the extension is always registered and decorations are
 *     gated on the CURRENT setting, not the mount-time value.
 *   - On docChanged: clears decorations (stale results dismissed) and bumps
 *     the tab's doc epoch so in-flight async lint completions are dropped.
 *   - diagnosticsChanged rebuilds are gated on docEpoch.ts: a link-check
 *     Promise that resolves AFTER an edit must not map stale line numbers
 *     onto the edited doc.
 *   - skips "sourceOnly" diagnostics — they cannot be represented in WYSIWYG.
 *   - Diagnostic lines are mapped to blocks via lineMap.ts, which mirrors the
 *     serialized markdown the lint engine actually saw (blank separators,
 *     code fences, list-item lines included).
 *
 * @coordinates-with lineMap.ts — source-line → top-level-block mapping
 * @coordinates-with docEpoch.ts — doc-revision guard against stale async completions
 * @coordinates-with stores/lintStore.ts — listens for diagnostic changes
 * @coordinates-with stores/settingsStore — markdown.lintEnabled gates decorations
 * @module plugins/lint/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useLintStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import { bumpLintDocEpoch, isLintRunCurrent } from "./docEpoch";
import { buildLineToBlockMap } from "./lineMap";
import "./lint.css";

const lintPluginKey = new PluginKey("markdownLintWysiwyg");

/** Live lint setting — read at decoration-build time so toggles apply without a remount. */
function isLintEnabled(): boolean {
  return useSettingsStore.getState().markdown.lintEnabled;
}

/** Build decorations from diagnostics. Skips "sourceOnly" entries.
 *  Diagnostic lines are 1-based lines in the SERIALIZED markdown (the exact
 *  text runActiveLint linted), so blocks are located via buildLineToBlockMap,
 *  which re-serializes the doc with the same pipeline. Each diagnostic is
 *  then looked up in O(1). */
function buildDecorations(doc: PMNode, diagnostics: LintDiagnostic[]): DecorationSet {
  if (!diagnostics || diagnostics.length === 0) {
    return DecorationSet.empty;
  }

  const lineToBlock = buildLineToBlockMap(doc);

  const decos: Decoration[] = [];

  for (const d of diagnostics) {
    if (d.uiHint === "sourceOnly") continue;

    const block = lineToBlock.get(d.line);
    if (!block) continue;

    const className =
      d.severity === "error" ? "lint-block-error" : "lint-block-warning";

    decos.push(
      Decoration.node(block.pos, block.pos + block.node.nodeSize, {
        class: className,
      })
    );
  }

  return DecorationSet.create(doc, decos);
}

export interface LintExtensionOptions {
  /** Tab ID to scope diagnostics to. Empty string = disabled. */
  tabId: string;
}

/** Tiptap extension that decorates WYSIWYG blocks with lint diagnostic markers. */
export const LintExtension = Extension.create<LintExtensionOptions>({
  name: "markdownLint",

  addOptions() {
    return { tabId: "" };
  },

  addProseMirrorPlugins() {
    const { tabId } = this.options;
    if (!tabId) return [];

    return [
      new Plugin({
        key: lintPluginKey,

        view: (editorView) => {
          let destroyed = false;
          const dispatchRebuild = () => {
            runOrQueueProseMirrorAction(editorView, () => {
              if (destroyed) return;
              editorView.dispatch(
                editorView.state.tr.setMeta(lintPluginKey, "diagnosticsChanged")
              );
            });
          };

          // Only react when diagnostics are ADDED (runLint), not cleared.
          // Clears are handled by apply() returning DecorationSet.empty on docChanged.
          let prevDiagnostics = useLintStore.getState().diagnosticsByTab[tabId];
          const unsubscribe = useLintStore.subscribe((state) => {
            if (destroyed) return;
            const nextDiagnostics = state.diagnosticsByTab[tabId];
            // Skip if diagnostics were removed (cleared) — only react to new results
            if (!nextDiagnostics || nextDiagnostics.length === 0) {
              prevDiagnostics = nextDiagnostics;
              return;
            }
            if (nextDiagnostics !== prevDiagnostics) {
              prevDiagnostics = nextDiagnostics;
              dispatchRebuild();
            }
          });

          // React to the lint toggle so it takes effect without a remount:
          // OFF rebuilds to empty (clears lingering decorations), ON rebuilds
          // from whatever diagnostics the store currently holds. Plain
          // subscribe with manual prev tracking (project convention).
          let prevEnabled = isLintEnabled();
          const unsubscribeSettings = useSettingsStore.subscribe((state) => {
            if (destroyed) return;
            const enabled = state.markdown.lintEnabled;
            if (enabled === prevEnabled) return;
            prevEnabled = enabled;
            dispatchRebuild();
          });

          return {
            destroy: () => {
              destroyed = true;
              unsubscribe();
              unsubscribeSettings();
            },
          };
        },

        state: {
          init(_, { doc }) {
            if (!isLintEnabled()) return DecorationSet.empty;
            // A remount (e.g. mode switch) must not repaint diagnostics the
            // store still holds from BEFORE the last doc change — same stale
            // guard the diagnosticsChanged path applies.
            if (!isLintRunCurrent(tabId)) return DecorationSet.empty;
            const diagnostics =
              useLintStore.getState().diagnosticsByTab[tabId] ?? [];
            return buildDecorations(doc, diagnostics);
          },

          apply(tr, oldDecorations) {
            // Clear decorations on doc edit — stale results should disappear.
            // We only clear the DECORATIONS here, not the store — clearing the
            // store from apply() causes an infinite loop via subscribe → dispatch.
            // The store is cleared naturally by the next runLint or tab close.
            if (tr.docChanged) {
              // Record the change so an async lint completion that started
              // BEFORE this edit is recognized as stale when it arrives.
              bumpLintDocEpoch(tabId);
              return DecorationSet.empty;
            }

            // Rebuild when diagnostics were updated (or the lint toggle
            // flipped — disabled lint always rebuilds to empty).
            if (tr.getMeta(lintPluginKey) === "diagnosticsChanged") {
              if (!isLintEnabled()) return DecorationSet.empty;
              // Drop stale rebuilds: results computed from content captured
              // before the latest doc change must not be mapped onto the
              // edited doc.
              if (!isLintRunCurrent(tabId)) return DecorationSet.empty;
              const diagnostics =
                useLintStore.getState().diagnosticsByTab[tabId] ?? [];
              return buildDecorations(tr.doc, diagnostics);
            }

            // Remap existing decorations through non-doc-changing transactions
            return oldDecorations.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return lintPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
