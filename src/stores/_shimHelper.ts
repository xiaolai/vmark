/**
 * Slice shim helper for the popup-cluster backward-compat shims.
 *
 * Each shim exposes the legacy `useXStore` API (selector hook +
 * `getState`/`setState`/`subscribe`) but routes through the merged
 * popupStore's namespaced slice. Lets existing consumer code and test
 * mocks keep working while the Zustand instance count drops from 15
 * down to 1.
 *
 * @module stores/_shimHelper
 */

import type { StoreApi, UseBoundStore } from "zustand";
import { usePopupStore, type PopupStore } from "./popupStore";

type SliceKey = keyof PopupStore;

/** Slice shim: a selector hook + getState/setState/subscribe over a
 *  single named slice of the merged store, plus the slice's actions
 *  re-exported under their legacy unprefixed names. */
export function createSliceShim<
  K extends SliceKey,
  Actions extends Record<string, (...args: never[]) => unknown>,
>(
  sliceKey: K,
  actions: Actions,
): UseBoundStore<StoreApi<PopupStore[K] & Actions>> {
  type SliceData = PopupStore[K] & Actions;

  function readSlice(): SliceData {
    const root = usePopupStore.getState();
    return { ...(root[sliceKey] as object), ...actions } as SliceData;
  }

  // The selector hook: subscribes to popupStore, projects the slice +
  // re-bundled actions.
  const hook = (<T>(selector?: (state: SliceData) => T) =>
    usePopupStore((root) => {
      const sliceData = {
        ...(root[sliceKey] as object),
        ...actions,
      } as SliceData;
      return selector ? selector(sliceData) : sliceData;
    })) as UseBoundStore<StoreApi<SliceData>>;

  hook.getState = readSlice;
  hook.getInitialState = readSlice;
  hook.setState = ((
    partial:
      | Partial<SliceData>
      | ((s: SliceData) => Partial<SliceData>),
  ) => {
    usePopupStore.setState((root) => {
      const current = {
        ...(root[sliceKey] as object),
        ...actions,
      } as SliceData;
      const next =
        typeof partial === "function" ? partial(current) : partial;
      // Filter out actions before merging into slice
      const sliceUpdate: Record<string, unknown> = {};
      for (const k of Object.keys(next)) {
        if (!(k in actions)) {
          sliceUpdate[k] = (next as Record<string, unknown>)[k];
        }
      }
      return {
        [sliceKey]: {
          ...(root[sliceKey] as object),
          ...sliceUpdate,
        },
      } as Partial<PopupStore>;
    });
  }) as UseBoundStore<StoreApi<SliceData>>["setState"];

  hook.subscribe = (listener: (state: SliceData, prev: SliceData) => void) =>
    usePopupStore.subscribe((rootNext, rootPrev) => {
      const sliceNext = {
        ...(rootNext[sliceKey] as object),
        ...actions,
      } as SliceData;
      const slicePrev = {
        ...(rootPrev[sliceKey] as object),
        ...actions,
      } as SliceData;
      listener(sliceNext, slicePrev);
    });

  return hook;
}
