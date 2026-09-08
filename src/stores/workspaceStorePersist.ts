/**
 * Rehydration normalization for the workspace store (audit #1017).
 *
 * Purpose: persisted state re-enters the store through zustand's `merge`, which
 * by default is a SHALLOW object merge — so a config written by an older build,
 * or edited/corrupted in localStorage, reached live state without ever passing
 * `normalizeWorkspaceConfig`. Every other entry point runs that normalizer;
 * this is the one that did not, and it is the one whose input the app did not
 * write in this session.
 *
 * **There is deliberately no `version` / `migrate` pair here**, though that is
 * the reflexive answer. zustand DISCARDS persisted state when the stored
 * version differs and no `migrate` is supplied — so adding a version bump on
 * its own would wipe every existing user's workspace, root path included, on
 * first launch. Normalizing on merge fixes legacy shapes without that cliff,
 * and a real migration can be added later when there is a schema change that
 * actually needs one.
 *
 * @coordinates-with stores/workspaceStore.ts — sole consumer, via persist({ merge })
 * @coordinates-with stores/workspaceConfigDefaults.ts — the shared normalizer
 * @module stores/workspaceStorePersist
 */

import { workspaceError } from "@/utils/debug";
import { normalizeWorkspaceConfig, type WorkspaceConfig } from "./workspaceConfigDefaults";

/**
 * Bring a rehydrated `config` to the shape every action assumes: defaults
 * filled in, an identity present, arrays owned by the store.
 *
 * A value that is not an object at all (a string, a number, an array — all of
 * them reachable from a hand-edited or half-written storage entry) is dropped
 * rather than normalized: spreading one produces a nonsense config whose keys
 * are string indices, and "no workspace config" is a state the store already
 * handles on every action.
 */
export function normalizeRehydratedConfig(config: unknown): WorkspaceConfig | null {
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) {
    workspaceError("Discarding a persisted workspace config that is not an object:", config);
    return null;
  }
  return structuredClone(normalizeWorkspaceConfig(config as WorkspaceConfig));
}
