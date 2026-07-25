# VMark architecture — coupling metrics (generated)

Computed by `dependency-cruiser`. **Ca** = afferent (who depends on it),
**Ce** = efferent (what it depends on), **I** = instability `Ce/(Ca+Ce)`
(0% = stable core, 100% = unstable leaf). Regenerate with `pnpm arch:metrics`;
do not hand-edit. See `architecture-graph.md` for the visual.

## Top-level `src` folders (by total coupling)

| Module | Ca (used by) | Ce (uses) | I (instability) |
|---|--:|--:|--:|
| `src/stores` | 767 | 99 | 11% |
| `src/utils` | 750 | 11 | 1% |
| `src/plugins` | 150 | 557 | 79% |
| `src/services` | 271 | 432 | 61% |
| `src/hooks` | 121 | 537 | 82% |
| `src/components` | 45 | 577 | 93% |
| `src/lib` | 145 | 52 | 26% |
| `src/pages` | 3 | 72 | 96% |
| `src/export` | 4 | 65 | 94% |
| `src/contexts` | 40 | 24 | 38% |
| `src/types` | 56 | 1 | 2% |
| `src/test` | 0 | 13 | 100% |
| `src/locales` | 12 | 0 | 0% |
| `src/theme` | 9 | 0 | 0% |
| `src/styles` | 6 | 0 | 0% |
| `src/workspace` | 1 | 4 | 80% |
| `src/shell` | 2 | 0 | 0% |
| `src/assets` | 1 | 0 | 0% |
| `src/shared` | 1 | 0 | 0% |
| `src/bench` | 0 | 0 | 0% |

## Most-coupled modules (top 30 — the change-with-care / god-module watch list)

High **Ca** with low **I** = a hub many modules depend on. High **Ce** = a
module reaching broadly. Either is a signal to keep the file small and stable.

| Module | Ca (used by) | Ce (uses) | I (instability) |
|---|--:|--:|--:|
| `src/utils/debug.ts` | 212 | 3 | 1% |
| `src/stores/settingsStore.ts` | 134 | 10 | 7% |
| `src/stores/tabStore.ts` | 131 | 10 | 7% |
| `src/stores/documentStore.ts` | 116 | 6 | 5% |
| `src/i18n.ts` | 99 | 4 | 4% |
| `src/utils/imeGuard.ts` | 80 | 0 | 0% |
| `src/utils/errorMessage.ts` | 78 | 0 | 0% |
| `src/stores/uiStore.ts` | 67 | 4 | 6% |
| `src/services/assembly/tiptapExtensions.ts` | 2 | 62 | 97% |
| `src/stores/workspaceStore.ts` | 52 | 5 | 9% |
| `src/services/ime/imeToast.ts` | 53 | 2 | 4% |
| `src/contexts/WindowContext.tsx` | 36 | 13 | 27% |
| `src/services/persistence/workspaceStorage.ts` | 37 | 2 | 5% |
| `src/App.tsx` | 1 | 37 | 97% |
| `src/plugins/codemirror/index.ts` | 4 | 32 | 89% |
| `src/services/navigation/fileOpen.ts` | 9 | 23 | 72% |
| `src/lib/formats/registry.ts` | 30 | 2 | 6% |
| `src/lib/ghaWorkflow/types.ts` | 32 | 0 | 0% |
| `src/components/StatusBar/StatusBar.tsx` | 1 | 27 | 96% |
| `src/stores/popupStore.ts` | 22 | 6 | 21% |
| `src/stores/editorStore.ts` | 25 | 3 | 11% |
| `src/components/Editor/TiptapEditor.tsx` | 1 | 26 | 96% |
| `src/pages/settings/components.tsx` | 23 | 4 | 15% |
| `src/lib/formats/types.ts` | 26 | 1 | 4% |
| `src/stores/workflowStore.ts` | 20 | 6 | 23% |
| `src/utils/popupPosition.ts` | 26 | 0 | 0% |
| `src/services/assembly/sourceEditorExtensions.ts` | 2 | 22 | 92% |
| `src/utils/safeUnlisten.ts` | 21 | 2 | 9% |
| `src/utils/paths/index.ts` | 22 | 1 | 4% |
| `src/hooks/useFinderFileOpen.ts` | 2 | 20 | 91% |
