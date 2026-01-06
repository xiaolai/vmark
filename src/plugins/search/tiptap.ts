import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useSearchStore } from "@/stores/searchStore";

const searchPluginKey = new PluginKey("search");

interface Match {
  from: number;
  to: number;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchesInDoc(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): Match[] {
  if (!query) return [];

  const matches: Match[] = [];
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

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return [];
  }

  let textOffset = 0;
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap[textOffset + i] = pos + i;
      }
      textOffset += node.text.length;
    }
  });

  const text = doc.textContent;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const from = posMap[match.index];
    const to = posMap[match.index + match[0].length - 1];

    if (from !== undefined && to !== undefined) {
      matches.push({ from, to: to + 1 });
    }

    if (match[0].length === 0) regex.lastIndex++;
  }

  return matches;
}

export const searchExtension = Extension.create({
  name: "search",
  addProseMirrorPlugins() {
    let lastQuery = "";
    let lastCaseSensitive = false;
    let lastWholeWord = false;
    let lastUseRegex = false;
    let matches: Match[] = [];

    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return { matches: [] as Match[], currentIndex: -1 };
          },
          apply(tr, _value) {
            const state = useSearchStore.getState();
            const queryChanged =
              state.query !== lastQuery ||
              state.caseSensitive !== lastCaseSensitive ||
              state.wholeWord !== lastWholeWord ||
              state.useRegex !== lastUseRegex;

            if (queryChanged || tr.docChanged) {
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

              useSearchStore.getState().setMatches(matches.length, matches.length > 0 ? 0 : -1);
            }

            const currentIndex = useSearchStore.getState().currentIndex;
            return { matches, currentIndex };
          },
        },
        props: {
          decorations(state) {
            const searchState = useSearchStore.getState();
            if (!searchState.isOpen || !searchState.query) {
              return DecorationSet.empty;
            }

            const pluginState = searchPluginKey.getState(state);
            if (!pluginState || pluginState.matches.length === 0) {
              return DecorationSet.empty;
            }

            const decorations = pluginState.matches.map((match: Match, i: number) => {
              const isActive = i === pluginState.currentIndex;
              return Decoration.inline(match.from, match.to, {
                class: isActive ? "search-match search-match-active" : "search-match",
              });
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
        view(editorView) {
          let lastScrolledIndex = -1;

          const scrollToMatch = () => {
            const state = useSearchStore.getState();
            if (!state.isOpen || state.currentIndex < 0) return;
            if (state.currentIndex === lastScrolledIndex) return;

            const pluginState = searchPluginKey.getState(editorView.state);
            if (!pluginState || !pluginState.matches[state.currentIndex]) return;

            const match = pluginState.matches[state.currentIndex];
            lastScrolledIndex = state.currentIndex;

            const coords = editorView.coordsAtPos(match.from);
            const editorRect = editorView.dom.getBoundingClientRect();

            if (coords.top < editorRect.top || coords.bottom > editorRect.bottom) {
              editorView.dom.scrollTo({
                top: editorView.dom.scrollTop + coords.top - editorRect.top - editorRect.height / 3,
                behavior: "smooth",
              });
            }
          };

          const handleReplaceCurrent = () => {
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
            editorView.dispatch(tr);

            requestAnimationFrame(() => {
              useSearchStore.getState().findNext();
            });
          };

          const handleReplaceAll = () => {
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

            editorView.dispatch(tr);
          };

          let prevState = {
            query: useSearchStore.getState().query,
            caseSensitive: useSearchStore.getState().caseSensitive,
            wholeWord: useSearchStore.getState().wholeWord,
            useRegex: useSearchStore.getState().useRegex,
            currentIndex: useSearchStore.getState().currentIndex,
            isOpen: useSearchStore.getState().isOpen,
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

            if (JSON.stringify(currentState) !== JSON.stringify(prevState)) {
              prevState = currentState;
              editorView.dispatch(editorView.state.tr);
              requestAnimationFrame(scrollToMatch);
            }
          });

          window.addEventListener("search:replace-current", handleReplaceCurrent);
          window.addEventListener("search:replace-all", handleReplaceAll);

          return {
            destroy() {
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

