/**
 * instanceRekeyBus — decoupled fan-out for loose-instance identity re-keys
 * (audit 20260831 #9).
 *
 * Purpose: `ensureLooseInstance` re-keys an instance's identity and every
 * per-instance store must follow. Most followers are imported directly by the
 * instances store (acyclic), but `tabStoreClosedScopes` IMPORTS the instances
 * store for scope resolution — a direct call back would create an import
 * cycle. Same pattern as tabRemovalBus: the store that owns the event
 * notifies; interested stores subscribe at module scope.
 *
 * @coordinates-with stores/workspaceInstancesStore.ts — the notifier
 * @coordinates-with stores/tabStoreClosedScopes.ts — rekeys its scope slot
 * @module stores/instanceRekeyBus
 */

type InstanceRekeyListener = (
  windowLabel: string,
  oldId: string,
  newId: string,
) => void;

const listeners = new Set<InstanceRekeyListener>();

/** Subscribe to identity re-keys. Returns an unsubscribe function. */
export function onInstanceRekeyed(listener: InstanceRekeyListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify every follower that `oldId` is now `newId` in `windowLabel`. */
export function notifyInstanceRekeyed(
  windowLabel: string,
  oldId: string,
  newId: string,
): void {
  for (const listener of listeners) listener(windowLabel, oldId, newId);
}
