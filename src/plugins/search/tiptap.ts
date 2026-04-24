/**
 * Search Plugin (WYSIWYG Mode)
 *
 * Purpose: Highlights find/replace matches in the WYSIWYG editor using ProseMirror
 * decorations. Subscribes to searchStore for query/options and rebuilds decorations
 * on every state change where the query or document differs.
 *
 * Pipeline: searchStore query change → rebuild decorations → highlight matches →
 *           navigate via next/prev/replace dispatched from FindBar
 *
 * Key decisions:
 *   - Decorations are rebuilt on doc/query change, not on every transaction
 *   - setMatches() is deferred via queueMicrotask to avoid side-effects in apply()
 *   - Store subscription uses field-by-field equality (not JSON.stringify)
 *   - Replace operations use imeGuard to avoid conflicts with IME composition
 *   - Regex mode catches invalid patterns gracefully (shows 0 matches, no error)
 *   - Doc-change rebuilds are debounced by SEARCH_DOC_CHANGE_DEBOUNCE_MS (200ms) to
 *     avoid rescanning the entire document on every keystroke; query/option changes
 *     still trigger immediate rebuilds for responsive search-box feedback
 *
 * @coordinates-with searchStore.ts — query, options, match navigation state
 * @coordinates-with FindBar.tsx — UI for find/replace controls
 * @coordinates-with sourceEditorSearch.ts — equivalent search for Source mode (CodeMirror)
 * @module plugins/search/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useSearchStore } from "@/stores/searchStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import { createQueryDebounce } from "./queryDebounce";
import "./search.css";

const searchPluginKey = new PluginKey("search");

/** Meta key used to trigger a debounced full rebuild transaction from the timeout. */
const SEARCH_DEBOUNCED_REBUILD_META = "searchDebouncedRebuild";

/**
 * Milliseconds to wait after a doc change before performing a full match re-scan.
 * Query/option changes use SEARCH_QUERY_CHANGE_DEBOUNCE_MS (smaller).
 */
export const SEARCH_DOC_CHANGE_DEBOUNCE_MS = 200;

/**
 * Milliseconds to wait after the query (or options) changes before triggering
 * a full rebuild. Coalesces rapid keystrokes in the FindBar input so we don't
 * pay an O(doc) regex scan per character. Navigation (Enter, prev/next) and
 * open/close still take effect immediately and flush any pending rebuild so
 * the user always navigates against fresh matches.
 */
export const SEARCH_QUERY_CHANGE_DEBOUNCE_MS = 150;

interface Match {
  from: number;
  to: number;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): RegExp | null {
  if (!query) return null;

  const flags = caseSensitive ? "g" : "gi";
  let pattern: string;

  if (useRegex) {
    pattern = query;
  } else {
    pattern = escapeRegExp(query);
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function findMatchesInDoc(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): Match[] {
  const regex = buildRegex(query, caseSensitive, wholeWord, useRegex);
  if (!regex) return [];

  const matches: Match[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    regex.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(node.text)) !== null) {
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      if (m[0].length === 0) regex.lastIndex++;
    }
  });

  return matches;
}

/** Tiptap extension that provides find/replace highlighting and navigation. */
export const searchExtension = Extension.create({
  name: "search",
  addProseMirrorPlugins() {
    let lastQuery = "";
    let lastCaseSensitive = false;
    let lastWholeWord = false;
    let lastUseRegex = false;
    let matches: Match[] = [];

    // Debounce state: pending timeout ID and a weak reference to the view
    // used to dispatch the deferred rebuild transaction.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    // eslint-disable-next-line prefer-const
    let viewRef: { current: import("@tiptap/pm/view").EditorView | null } = { current: null };

    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return { matches: [] as Match[], currentIndex: -1, decorationSet: DecorationSet.empty };
          },
          apply(tr, value) {
            const state = useSearchStore.getState();
            const queryChanged =
              state.query !== lastQuery ||
              state.caseSensitive !== lastCaseSensitive ||
              state.wholeWord !== lastWholeWord ||
              state.useRegex !== lastUseRegex;

            // Helper: build and return a new state after a full match re-scan.
            const fullRebuild = () => {
              lastQuery = state.query;
              lastCaseSensitive = state.caseSensitive;
              lastWholeWord = state.wholeWord;
              lastUseRegex = state.useRegex;

              matches = findMatchesInDoc(
                tr.doc,
                state.query,
                state.caseSensitive,
                state.wholeWord,
                state.useRegex
              );

              const matchCount = matches.length;
              const initialIndex = matchCount > 0 ? 0 : -1;
              // Defer store update out of ProseMirror's apply() to avoid side-effects during state computation
              queueMicrotask(() => {
                useSearchStore.getState().setMatches(matchCount, initialIndex);
              });

              const currentIndex = useSearchStore.getState().currentIndex;
              let decorationSet = DecorationSet.empty;
              if (state.isOpen && state.query && matches.length > 0) {
                const decorations = matches.map((match: Match, i: number) =>
                  Decoration.inline(match.from, match.to, {
                    class: i === currentIndex ? "search-match search-match-active" : "search-match",
                  })
                );
                decorationSet = DecorationSet.create(tr.doc, decorations);
              }
              return { matches, currentIndex, decorationSet };
            };

            // Path 1 — Debounce timer fired: do the full rebuild now.
            if (tr.getMeta(SEARCH_DEBOUNCED_REBUILD_META) && (state.isOpen || state.query)) {
              debounceTimer = null;
              return fullRebuild();
            }

            // Path 2 — Query/options changed: immediate rebuild (user expects instant feedback).
            if (queryChanged && (state.isOpen || state.query)) {
              // Cancel any pending debounced rebuild since we're doing a full one now
              if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
              }
              return fullRebuild();
            }

            // Path 3 — Document changed while search is open (but query unchanged): debounce.
            // Map existing decorations through the change to keep them roughly positioned,
            // then schedule a full re-scan after SEARCH_DOC_CHANGE_DEBOUNCE_MS.
            if (tr.docChanged && (state.isOpen || state.query)) {
              // Coalesce rapid edits: reset timer on each doc change
              if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
              }
              debounceTimer = setTimeout(() => {
                debounceTimer = null;
                const view = viewRef.current;
                if (!view || view.isDestroyed) return;
                runOrQueueProseMirrorAction(view, () => {
                  view.dispatch(view.state.tr.setMeta(SEARCH_DEBOUNCED_REBUILD_META, true));
                });
              }, SEARCH_DOC_CHANGE_DEBOUNCE_MS);

              // Return mapped decorations and matches until the debounce fires.
              // Map match positions so navigate/replace targets correct text.
              const mappedDecorationSet = value.decorationSet.map(tr.mapping, tr.doc);
              // Update the module-level matches cache so Path 4 reads correct positions
              matches = matches
                .map((m: Match) => ({ from: tr.mapping.map(m.from), to: tr.mapping.map(m.to) }))
                .filter((m: Match) => m.from < m.to);
              const currentIndex = useSearchStore.getState().currentIndex;
              // Adjust index if matches were lost due to mapping collapse
              const adjustedIndex = matches.length === 0
                ? -1
                : currentIndex >= matches.length
                  ? 0
                  : currentIndex;
              queueMicrotask(() => {
                useSearchStore.getState().setMatches(matches.length, adjustedIndex);
              });
              return { matches, currentIndex: adjustedIndex, decorationSet: mappedDecorationSet };
            }

            const currentIndex = useSearchStore.getState().currentIndex;

            // Path 4 — No structural change; only update decorations if active index changed.
            if (currentIndex !== value.currentIndex) {
              let decorationSet = DecorationSet.empty;
              if (state.isOpen && state.query && matches.length > 0) {
                const decorations = matches.map((match: Match, i: number) =>
                  Decoration.inline(match.from, match.to, {
                    class: i === currentIndex ? "search-match search-match-active" : "search-match",
                  })
                );
                decorationSet = DecorationSet.create(tr.doc, decorations);
              }
              return { matches, currentIndex, decorationSet };
            }

            return { matches, currentIndex, decorationSet: value.decorationSet };
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchPluginKey.getState(state);
            return pluginState?.decorationSet ?? DecorationSet.empty;
          },
        },
        view(editorView) {
          // Store the view reference so the debounce timer can dispatch into it
          viewRef.current = editorView;
          let lastScrollKey = "";

          const scrollToMatch = () => {
            const state = useSearchStore.getState();
            if (!state.isOpen || state.currentIndex < 0) return;

            const scrollKey = `${state.query}|${state.caseSensitive}|${state.wholeWord}|${state.useRegex}|${state.currentIndex}`;
            if (scrollKey === lastScrollKey) return;

            const pluginState = searchPluginKey.getState(editorView.state);
            if (!pluginState || !pluginState.matches[state.currentIndex]) return;

            const match = pluginState.matches[state.currentIndex];
            lastScrollKey = scrollKey;

            // Scroll container is .editor-content, not editorView.dom (.ProseMirror)
            const scrollContainer = editorView.dom.closest(".editor-content") as HTMLElement | null;
            if (!scrollContainer) return;

            const coords = editorView.coordsAtPos(match.from);
            const containerRect = scrollContainer.getBoundingClientRect();

            if (coords.top < containerRect.top || coords.bottom > containerRect.bottom) {
              scrollContainer.scrollTo({
                top: scrollContainer.scrollTop + coords.top - containerRect.top - containerRect.height / 3,
                behavior: "smooth",
              });
            }
          };

          const handleReplaceCurrent = () => {
            if (editorView.editable === false) return;
            const state = useSearchStore.getState();
            if (!state.isOpen || state.currentIndex < 0) return;

            const pluginState = searchPluginKey.getState(editorView.state);
            if (!pluginState || !pluginState.matches[state.currentIndex]) return;

            const match = pluginState.matches[state.currentIndex];
            const tr = editorView.state.tr.replaceWith(
              match.from,
              match.to,
              state.replaceText ? editorView.state.schema.text(state.replaceText) : []
            );
            runOrQueueProseMirrorAction(editorView, () => editorView.dispatch(tr));

            requestAnimationFrame(() => {
              useSearchStore.getState().findNext();
            });
          };

          const handleReplaceAll = () => {
            if (editorView.editable === false) return;
            const state = useSearchStore.getState();
            if (!state.isOpen || !state.query) return;

            const pluginState = searchPluginKey.getState(editorView.state);
            if (!pluginState || pluginState.matches.length === 0) return;

            const sortedMatches = [...pluginState.matches].sort((a, b) => b.from - a.from);
            let tr = editorView.state.tr;

            for (const match of sortedMatches) {
              tr = tr.replaceWith(
                match.from,
                match.to,
                state.replaceText ? editorView.state.schema.text(state.replaceText) : []
              );
            }

            runOrQueueProseMirrorAction(editorView, () => editorView.dispatch(tr));
          };

          let prevState = {
            query: useSearchStore.getState().query,
            caseSensitive: useSearchStore.getState().caseSensitive,
            wholeWord: useSearchStore.getState().wholeWord,
            useRegex: useSearchStore.getState().useRegex,
            currentIndex: useSearchStore.getState().currentIndex,
            isOpen: useSearchStore.getState().isOpen,
          };

          // Single debounce slot for query/options changes. Nav/open changes
          // bypass it so user input feels instant; nav also flushes any
          // pending rebuild first so it never operates on stale matches.
          const queryDebounce = createQueryDebounce(SEARCH_QUERY_CHANGE_DEBOUNCE_MS);

          const dispatchEmptyTransaction = () => {
            if (editorView.isDestroyed) return;
            runOrQueueProseMirrorAction(editorView, () =>
              editorView.dispatch(editorView.state.tr),
            );
            requestAnimationFrame(scrollToMatch);
          };

          const unsubscribe = useSearchStore.subscribe((state) => {
            const currentState = {
              query: state.query,
              caseSensitive: state.caseSensitive,
              wholeWord: state.wholeWord,
              useRegex: state.useRegex,
              currentIndex: state.currentIndex,
              isOpen: state.isOpen,
            };

            const queryOptionsChanged =
              currentState.query !== prevState.query ||
              currentState.caseSensitive !== prevState.caseSensitive ||
              currentState.wholeWord !== prevState.wholeWord ||
              currentState.useRegex !== prevState.useRegex;

            const navOrOpenChanged =
              currentState.currentIndex !== prevState.currentIndex ||
              currentState.isOpen !== prevState.isOpen;

            if (!queryOptionsChanged && !navOrOpenChanged) return;

            prevState = currentState;

            if (navOrOpenChanged) {
              // Force any pending query rebuild to fire first so navigation
              // operates on fresh matches. The flush itself runs the same
              // dispatchEmptyTransaction we'd otherwise call, so we only
              // dispatch when nothing was pending — otherwise we'd double-
              // dispatch and double-scroll for one user action.
              if (!queryDebounce.flushIfPending()) {
                dispatchEmptyTransaction();
              }
              return;
            }

            // Query/options change only: coalesce rapid keystrokes.
            queryDebounce.schedule(dispatchEmptyTransaction);
          });

          window.addEventListener("search:replace-current", handleReplaceCurrent);
          window.addEventListener("search:replace-all", handleReplaceAll);

          return {
            destroy() {
              // Clear pending debounce timers so they won't dispatch into a destroyed view
              if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
              }
              queryDebounce.cancel();
              viewRef.current = null;
              unsubscribe();
              window.removeEventListener("search:replace-current", handleReplaceCurrent);
              window.removeEventListener("search:replace-all", handleReplaceAll);
            },
          };
        },
      }),
    ];
  },
});
