/**
 * AI Provider Sync Hook
 *
 * Purpose: Propagates AI provider configuration between windows over the Tauri
 * event bus.
 *
 * Why events and not localStorage: every other cross-window store in this app
 * syncs via `storage` events, but useAiProviderStore persists through
 * tauri-plugin-store — a JSON FILE fronted by an in-memory cache — so a
 * `storage` event can never fire for it under any circumstances. Without this
 * bridge, adding a provider or switching the active one in the Settings window
 * is invisible to open document windows until restart, and both windows
 * blind-write the whole file (last write wins, no merge).
 *
 * SECURITY: the broadcast payload NEVER contains `apiKey`. Keys live in the OS
 * keychain and are rehydrated into memory per window; the persist layer already
 * strips them (see `partialize` in aiStore/provider.ts). Putting a key on the
 * event bus would be a strictly wider exposure than the keychain, for no gain —
 * the receiving window rehydrates the key itself from the keychain when a
 * `credentialsRevision` bump signals a rotation. Applying a remote snapshot
 * therefore preserves each window's locally-held key until such a reload.
 *
 * Key decisions:
 *   - Symmetric (both windows broadcast and listen), because either can edit.
 *   - Echo-suppressed via a module-level applied-snapshot ref, exactly as
 *     useUpdateSync does. That file documents what happens without it: the
 *     A↔B feedback loop hit the store thousands of times per second.
 *   - Request-state handshake on mount (like useUpdateSync): a freshly opened
 *     window asks peers for the current config instead of racing the async
 *     plugin-store save, and does not broadcast its own hydration snapshot.
 *   - Untrusted inbound payloads pass through sanitizeAiProviderPersist — the
 *     same validator hydration uses — before touching the store.
 *
 * @coordinates-with stores/aiStore/provider.ts — the synced store + revision
 * @coordinates-with hooks/useUpdateSync.ts — same bridge pattern
 * @module hooks/useAiProviderSync
 */

import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  sanitizeAiProviderPersist,
  useAiProviderStore,
} from "@/stores/aiStore/provider";
import { getApiKey } from "@/services/secrets/apiKeySecrets";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { aiProviderWarn } from "@/utils/debug";

export const AI_PROVIDER_STATE_EVENT = "ai-providers:state-changed";
export const AI_PROVIDER_REQUEST_EVENT = "ai-providers:request-state";

/** A REST provider entry with the secret removed. */
type SharedRestProvider = Omit<
  ReturnType<typeof useAiProviderStore.getState>["restProviders"][number],
  "apiKey"
>;

export interface AiProviderStatePayload {
  activeProvider: ReturnType<typeof useAiProviderStore.getState>["activeProvider"];
  restProviders: SharedRestProvider[];
  credentialsRevision: number;
}

/**
 * Window-scoped record of the last snapshot applied from a peer. The broadcast
 * pass compares against it and skips the emit, breaking the A↔B echo.
 */
let lastAppliedSnapshot: string | null = null;

/** Build the shareable snapshot of this window's provider config (no secrets). */
export function buildAiProviderSnapshot(): AiProviderStatePayload {
  const { activeProvider, restProviders, credentialsRevision } =
    useAiProviderStore.getState();
  return {
    activeProvider,
    restProviders: restProviders.map(({ apiKey: _apiKey, ...rest }) => rest),
    credentialsRevision,
  };
}

/**
 * Reload API keys from the keychain into memory for the given provider types.
 * Fire-and-forget: a peer signalled a rotation via credentialsRevision, and the
 * keychain (written before the bump) is the source of truth. Never touches the
 * event bus with a key.
 */
async function reloadKeysFromKeychain(types: string[]): Promise<void> {
  const entries = await Promise.all(
    types.map(async (type) => [type, await getApiKey(type)] as const),
  );
  const keyByType = new Map(entries);
  useAiProviderStore.setState((state) => ({
    restProviders: state.restProviders.map((p) =>
      keyByType.has(p.type) ? { ...p, apiKey: keyByType.get(p.type) ?? "" } : p,
    ),
  }));
}

/**
 * Apply a peer's provider config to this window, keeping this window's own
 * in-memory API keys unless the peer signalled a rotation. Exported for testing.
 */
export function applyRemoteAiProviderState(payload: AiProviderStatePayload): void {
  if (!payload || typeof payload !== "object") return;
  if (!Array.isArray(payload.restProviders)) return; // malformed — keep local

  // Same trust boundary hydration uses: coerces activeProvider to string|null
  // and drops entries without a string `type` or with non-string fields.
  const { activeProvider, restProviders: validated } = sanitizeAiProviderPersist({
    activeProvider: payload.activeProvider,
    restProviders: payload.restProviders,
  });

  const store = useAiProviderStore.getState();
  const localByType = new Map(store.restProviders.map((p) => [p.type, p]));
  const incomingRevision =
    typeof payload.credentialsRevision === "number" &&
    Number.isFinite(payload.credentialsRevision)
      ? payload.credentialsRevision
      : store.credentialsRevision;
  const credentialsRotated = incomingRevision > store.credentialsRevision;

  const merged = validated.map((entry) => ({
    ...entry,
    // Remote owns the configuration; the key is this window's, rehydrated from
    // the keychain. A remote payload carries no key, so preserving the local
    // one is what stops an adopted config from blanking a working credential.
    apiKey: localByType.get(entry.type)?.apiKey ?? "",
  }));

  lastAppliedSnapshot = JSON.stringify({
    activeProvider,
    restProviders: merged.map(({ apiKey: _apiKey, ...rest }) => rest),
    credentialsRevision: incomingRevision,
  });

  useAiProviderStore.setState({
    activeProvider,
    restProviders: merged,
    credentialsRevision: incomingRevision,
  });

  // A rotation elsewhere: reload the affected keys from the keychain (source of
  // truth). The key value never rides the event that triggered this.
  if (credentialsRotated) {
    void reloadKeysFromKeychain(merged.map((p) => p.type)).catch((error) => {
      aiProviderWarn("failed to reload rotated keys from keychain", error);
    });
  }
}

/**
 * Broadcasts local provider-config changes to other windows and applies
 * incoming ones. Mount in every window that reads or edits providers.
 */
export function useAiProviderSync(): void {
  const activeProvider = useAiProviderStore((state) => state.activeProvider);
  const restProviders = useAiProviderStore((state) => state.restProviders);
  const credentialsRevision = useAiProviderStore(
    (state) => state.credentialsRevision,
  );
  const prevSnapshot = useRef<string | null>(null);

  // Inbound: apply peer snapshots, and answer peers' state requests.
  useEffect(() => {
    const unlistenState = listen<AiProviderStatePayload>(
      AI_PROVIDER_STATE_EVENT,
      (event) => applyRemoteAiProviderState(event.payload),
    );
    unlistenState.catch((error) => {
      aiProviderWarn("ai provider state listener failed to register", error);
    });
    const unlistenRequest = listen(AI_PROVIDER_REQUEST_EVENT, () => {
      emit(AI_PROVIDER_STATE_EVENT, buildAiProviderSnapshot()).catch((error) => {
        aiProviderWarn("ai provider state reply failed", error);
      });
    });
    unlistenRequest.catch((error) => {
      aiProviderWarn("ai provider request listener failed to register", error);
    });
    return () => {
      safeUnlistenAsync(unlistenState);
      safeUnlistenAsync(unlistenRequest);
    };
  }, []);

  // Mount handshake: ask peers for the current config rather than trusting this
  // window's just-hydrated (possibly stale) plugin-store read.
  useEffect(() => {
    emit(AI_PROVIDER_REQUEST_EVENT).catch((error) => {
      aiProviderWarn("ai provider state request failed", error);
    });
  }, []);

  // Outbound: broadcast local changes.
  useEffect(() => {
    const snapshot = JSON.stringify(buildAiProviderSnapshot());

    // This state came from a peer — re-emitting it would echo back.
    if (lastAppliedSnapshot !== null && lastAppliedSnapshot === snapshot) {
      lastAppliedSnapshot = null;
      prevSnapshot.current = snapshot;
      return;
    }
    // Nothing actually changed (e.g. a set with identical values).
    if (prevSnapshot.current === snapshot) return;

    const isFirstPass = prevSnapshot.current === null;
    prevSnapshot.current = snapshot;
    lastAppliedSnapshot = null;
    // Don't broadcast the mount-time snapshot: it is just this window's
    // hydration, and emitting it would push a freshly-opened window's state
    // over a peer that has since changed something. The mount handshake pulls
    // the authoritative state instead.
    if (isFirstPass) return;

    emit(AI_PROVIDER_STATE_EVENT, JSON.parse(snapshot)).catch((error) => {
      aiProviderWarn("ai provider sync emit failed:", error);
    });
  }, [activeProvider, restProviders, credentialsRevision]);
}

/** Test-only: reset module-level echo-suppression state between cases. */
export function __resetAiProviderSyncStateForTests(): void {
  lastAppliedSnapshot = null;
}
