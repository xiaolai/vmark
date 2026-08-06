/**
 * Purpose: bind the plugin-owned state registries to the app's stores, the
 * way `bindPluginHostSettings` does at startup.
 *
 * Only the two registries whose state tests drive DIRECTLY through the app
 * store — not the whole assembly, which would pull every store into every
 * test file. Without this a test that calls
 * `useBlockMathEditingStore.getState().startEditing(...)` would be writing to
 * a store the plugin is not reading, and would silently assert nothing.
 *
 * @coordinates-with test/setup.ts — imported for its side effect
 * @module test/bindPluginRegistries
 */

import { bindBlockMathEditingStore } from "@/plugins/codePreview/editingRegistry";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import { bindSourcePeekStore } from "@/plugins/sourcePeekInline/peekStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";

bindBlockMathEditingStore(useBlockMathEditingStore as never);
bindSourcePeekStore(useSourcePeekStore as never);
