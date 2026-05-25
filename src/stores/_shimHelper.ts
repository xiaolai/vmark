/**
 * Slice shim helper for the popup-cluster backward-compat shims.
 *
 * Each shim exposes the legacy `useXStore` API (selector hook +
 * `getState`/`setState`/`subscribe`) but routes through the merged
 * popupStore's namespaced slice. Lets existing consumer code and test
 * mocks keep working while the Zustand instance count drops from 15
 * down to 1.
 *
 * Performance notes:
 *   - The hook's root selector projects ONLY this slice — Zustand's
 *     default `Object.is` equality skips re-renders when an unrelated
 *     slice updates.
 *   - A WeakMap caches the merged `{...slice, ...actions}` shape so the
 *     merged identity stays stable across calls that see the same
 *     underlying slice reference. Hot paths (selectors that pluck a
 *     single boolean, subscribers re-checking the same shape) no longer
 *     allocate a fresh merged object per call.
 *   - The `actions` bundle is bound once at module init — every shim
 *     allocates its action object exactly once.
 *
 * @module stores/_shimHelper
 */

import type { StoreApi, UseBoundStore } from "zustand";
import { usePopupStore, type PopupStore } from "./popupStore";

type SliceKey = keyof PopupStore;

/**
 * Slice shim factory. Returns a selector hook with `getState`, `setState`,
 * and `subscribe` scoped to one named slice of the merged popup store.
 * The slice's actions are re-exported under their original unprefixed
 * names so legacy consumers keep working.
 */
export function createSliceShim<
  K extends SliceKey,
  Actions extends Record<string, (...args: never[]) => unknown>,
>(
  sliceKey: K,
  actions: Actions,
): UseBoundStore<StoreApi<PopupStore[K] & Actions>> {
  type SliceData = PopupStore[K] & Actions;

  // Frozen action bundle — same object identity for every merge.
  const frozenActions = Object.freeze({ ...actions }) as Actions;

  // Cache merged shapes keyed by the underlying slice object so repeated
  // reads of an unchanged slice return the same merged identity.
  const mergedCache = new WeakMap<object, SliceData>();
  function mergeSlice(slice: object): SliceData {
    const cached = mergedCache.get(slice);
    if (cached) return cached;
    const merged = { ...slice, ...frozenActions } as SliceData;
    mergedCache.set(slice, merged);
    return merged;
  }

  function readSlice(): SliceData {
    return mergeSlice(usePopupStore.getState()[sliceKey] as object);
  }

  // The selector hook: project the slice (equality-aware), then map to
  // a stable merged shape, then run the consumer selector if any.
  const hook = (<T>(selector?: (state: SliceData) => T) => {
    const slice = usePopupStore((root) => root[sliceKey] as object);
    const merged = mergeSlice(slice);
    return selector ? selector(merged) : merged;
  }) as UseBoundStore<StoreApi<SliceData>>;

  hook.getState = readSlice;
  hook.getInitialState = readSlice;
  hook.setState = ((
    partial:
      | Partial<SliceData>
      | ((s: SliceData) => Partial<SliceData>),
  ) => {
    usePopupStore.setState((root) => {
      const currentSlice = root[sliceKey] as object;
      const current = mergeSlice(currentSlice);
      const next =
        typeof partial === "function" ? partial(current) : partial;
      // Filter out actions before merging into slice
      const sliceUpdate: Record<string, unknown> = {};
      for (const k of Object.keys(next)) {
        if (!(k in frozenActions)) {
          sliceUpdate[k] = (next as Record<string, unknown>)[k];
        }
      }
      return {
        [sliceKey]: {
          ...currentSlice,
          ...sliceUpdate,
        },
      } as Partial<PopupStore>;
    });
  }) as UseBoundStore<StoreApi<SliceData>>["setState"];

  hook.subscribe = (listener: (state: SliceData, prev: SliceData) => void) =>
    usePopupStore.subscribe((rootNext, rootPrev) => {
      const nextSlice = rootNext[sliceKey] as object;
      const prevSlice = rootPrev[sliceKey] as object;
      // Skip when this slice's reference is unchanged — root updates for
      // sibling slices must not wake this subscriber.
      if (nextSlice === prevSlice) return;
      listener(mergeSlice(nextSlice), mergeSlice(prevSlice));
    });

  return hook;
}
