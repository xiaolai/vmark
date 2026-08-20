/**
 * Keybinding registry service — the live index the capture adapters resolve
 * against (ADR-018, keybinding-unification Phase 1).
 *
 * Holds the current `BindingIndex`, rebuilt from the declared bindings whenever
 * the shortcut store changes (rebind propagation). Each `shortcutId` resolves to
 * a `CanonicalChord` through the store; a `fixedChord` binding resolves directly.
 * Bindings whose chord can't be resolved are dropped and logged (referential
 * integrity, WI-1.3).
 *
 * @coordinates-with stores/settingsStore/shortcuts.ts — the shortcut→key source
 * @coordinates-with utils/keybinding/canonicalChord.ts — the identity primitive
 * @module services/keybinding/keybindingRegistry
 */

import { useShortcutsStore } from "@/stores/settingsStore/shortcuts";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import {
  canonicalizeChordString,
  canonicalizeEvent,
  type CanonicalChord,
} from "@/utils/keybinding/canonicalChord";
import { keybindingWarn } from "@/utils/debug";
import {
  buildIndex,
  resolveBinding,
  type Binding,
  type BindingContext,
  type BindingIndex,
  type CaptureOwner,
  type ResolvedBinding,
} from "./bindingRegistry";

/** Resolve a rebindable `shortcutId` to its canonical chord via the store. */
export function resolveShortcutChord(shortcutId: string): CanonicalChord | null {
  const key = useShortcutsStore.getState().getShortcut(shortcutId);
  if (!key) return null; // unbound (empty defaultKey) → not indexed
  return canonicalizeChordString(key);
}

let declaredBindings: readonly Binding[] = [];
let index: BindingIndex = new Map();
let unsubscribe: (() => void) | null = null;
/** Monotonic id of the current installation; guards disposer identity. */
let installToken = 0;

/**
 * Ids the shortcut registry actually declares. Membership is what separates
 * "unbound" from "unknown" — `getShortcut` returns `""` for both.
 */
const KNOWN_SHORTCUT_IDS = new Set(DEFAULT_SHORTCUTS.map((s) => s.id));

function rebuild(): void {
  index = buildIndex(declaredBindings, resolveShortcutChord, (binding, reason) => {
    // An UNBOUND shortcut is normal, not a defect (#1301). Several shortcuts
    // ship with an empty `defaultKey`, and a user may clear any key in
    // Settings; both reach here identically because the store answers `""` for
    // either. Warning about them put a line in every user's production log on
    // every window load — `keybindingWarn` forwards to the Tauri log plugin —
    // and #1301 arrived with eight copies of
    // `Dropped binding view.toggleFitTables` in it, listed by the reporter as
    // a suspected cause of a freeze it had nothing to do with.
    //
    // The case that IS a defect survives: a binding naming a shortcut id the
    // registry does not declare. It is still dropped either way; only the
    // warning is scoped.
    if ("shortcutId" in binding && KNOWN_SHORTCUT_IDS.has(binding.shortcutId)) return;
    const id = binding.kind === "command" ? binding.commandId : "(containment)";
    keybindingWarn(`Dropped binding ${id}: ${reason}`);
  });
}

/**
 * Install the declared bindings and start tracking the shortcut store so a
 * rebind rebuilds the index without a reload. Returns a disposer. Idempotent —
 * calling again replaces the binding set (HMR / test-safe).
 */
export function installBindings(bindings: readonly Binding[]): () => void {
  // Identity guard: if two installations ever overlap (double-mount / HMR without
  // an intervening dispose), the STALE disposer must not tear down the newer
  // installation's subscription + index. Only the current owner may clean up.
  const token = ++installToken;
  declaredBindings = bindings;
  rebuild();
  unsubscribe?.();
  // The store is a plain zustand store; subscribe rebuilds on any change. The
  // index rebuild is cheap (a few dozen bindings) and only the chord mapping can
  // change, so a coarse subscription is correct and simple.
  unsubscribe = useShortcutsStore.subscribe(() => rebuild());
  return () => {
    if (token !== installToken) return; // a newer installation owns the state
    unsubscribe?.();
    unsubscribe = null;
    declaredBindings = [];
    index = new Map();
  };
}

/**
 * Resolve the winning binding for a live key event, for the adapter that owns
 * `owner`. Returns null when the event is not a chord or nothing applies.
 * Propagates `AmbiguousBindingError` (a registry-authoring bug) to the caller.
 */
export function resolveEvent(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  ctx: BindingContext,
  owner: CaptureOwner,
): ResolvedBinding | null {
  const chord = canonicalizeEvent(event);
  if (!chord) return null;
  return resolveBinding(index, chord, ctx, owner);
}

/** Test-only: the current index (read-only view). */
export function _getIndex(): BindingIndex {
  return index;
}
