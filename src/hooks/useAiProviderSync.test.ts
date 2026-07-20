import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RestProviderConfig } from "@/types/aiGenies";

// Capture Tauri event listeners so tests can drive them like the real bus.
const emitMock = vi.fn(() => Promise.resolve());
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const listenMock = vi.fn((name: string, cb: (event: { payload: unknown }) => void) => {
  listeners.set(name, cb);
  return Promise.resolve(() => listeners.delete(name));
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emitMock(...args),
  listen: (name: string, cb: (event: { payload: unknown }) => void) => listenMock(name, cb),
}));

const getApiKeyMock = vi.fn((type: string) => Promise.resolve(`keychain-key-for-${type}`));
vi.mock("@/services/secrets/apiKeySecrets", () => ({
  getApiKey: (type: string) => getApiKeyMock(type),
}));

import { useAiProviderStore } from "@/stores/aiStore/provider";
import {
  AI_PROVIDER_STATE_EVENT,
  AI_PROVIDER_REQUEST_EVENT,
  __resetAiProviderSyncStateForTests,
  applyRemoteAiProviderState,
  buildAiProviderSnapshot,
  useAiProviderSync,
  type AiProviderStatePayload,
} from "./useAiProviderSync";

/** A production-shaped REST provider (type, name, endpoint, apiKey, model). */
function restProvider(over: Partial<RestProviderConfig> = {}): RestProviderConfig {
  return {
    type: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com",
    apiKey: "sk-SECRET-must-never-leave-this-window",
    model: "gpt-4",
    ...over,
  };
}

/** A secret-free remote payload as it would arrive over the event bus. */
function payload(over: Partial<AiProviderStatePayload> = {}): AiProviderStatePayload {
  return {
    activeProvider: "openai",
    restProviders: [
      { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", model: "gpt-4" },
    ],
    credentialsRevision: 0,
    ...over,
  };
}

beforeEach(() => {
  emitMock.mockClear();
  listenMock.mockClear();
  getApiKeyMock.mockClear();
  listeners.clear();
  __resetAiProviderSyncStateForTests();
  useAiProviderStore.setState({
    activeProvider: null,
    restProviders: [restProvider()],
    credentialsRevision: 0,
  });
});

describe("buildAiProviderSnapshot", () => {
  // SECURITY: apiKey lives in memory (rehydrated from the OS keychain) but is
  // never persisted or broadcast. Broadcasting it would put it on the Tauri
  // event bus, a strictly wider exposure than the keychain.
  it("never includes apiKey in the broadcast payload", () => {
    const snapshot = buildAiProviderSnapshot();

    expect(JSON.stringify(snapshot)).not.toContain("sk-SECRET-must-never-leave-this-window");
    for (const provider of snapshot.restProviders) {
      expect(provider).not.toHaveProperty("apiKey");
    }
  });

  it("carries the production fields peers need (endpoint, model, revision)", () => {
    useAiProviderStore.setState({ activeProvider: "openai", credentialsRevision: 3 });

    const snapshot = buildAiProviderSnapshot();

    expect(snapshot.activeProvider).toBe("openai");
    expect(snapshot.credentialsRevision).toBe(3);
    expect(snapshot.restProviders[0]).toMatchObject({
      type: "openai",
      endpoint: "https://api.openai.com",
      model: "gpt-4",
    });
  });
});

describe("applyRemoteAiProviderState", () => {
  it("adopts a provider config change made in another window", () => {
    applyRemoteAiProviderState(
      payload({
        restProviders: [
          { type: "openai", name: "OpenAI", endpoint: "https://proxy.local", model: "gpt-4o" },
        ],
      }),
    );

    expect(useAiProviderStore.getState().activeProvider).toBe("openai");
    expect(useAiProviderStore.getState().restProviders[0].endpoint).toBe("https://proxy.local");
    expect(useAiProviderStore.getState().restProviders[0].model).toBe("gpt-4o");
  });

  it("preserves this window's in-memory apiKey when no rotation is signalled", () => {
    applyRemoteAiProviderState(
      payload({
        restProviders: [
          { type: "openai", name: "OpenAI", endpoint: "https://proxy.local", model: "gpt-4o" },
        ],
      }),
    );

    const provider = useAiProviderStore.getState().restProviders[0];
    expect(provider.endpoint).toBe("https://proxy.local"); // config applied
    expect(provider.apiKey).toBe("sk-SECRET-must-never-leave-this-window"); // local key kept
    expect(getApiKeyMock).not.toHaveBeenCalled(); // no keychain read without rotation
  });

  it("reloads keys from the keychain when the peer signals a rotation", async () => {
    await act(async () => {
      applyRemoteAiProviderState(payload({ credentialsRevision: 1 }));
      // let the fire-and-forget reload resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getApiKeyMock).toHaveBeenCalledWith("openai");
    expect(useAiProviderStore.getState().restProviders[0].apiKey).toBe("keychain-key-for-openai");
    expect(useAiProviderStore.getState().credentialsRevision).toBe(1);
  });

  it("adopts a newly added provider this window has never seen", () => {
    applyRemoteAiProviderState(
      payload({
        activeProvider: "anthropic",
        restProviders: [
          { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", model: "gpt-4" },
          { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", model: "claude" },
        ],
      }),
    );

    const types = useAiProviderStore.getState().restProviders.map((p) => p.type);
    expect(types).toContain("anthropic");
    expect(useAiProviderStore.getState().activeProvider).toBe("anthropic");
  });

  it("ignores a malformed payload rather than wiping providers", () => {
    applyRemoteAiProviderState({
      activeProvider: null,
      restProviders: "nope" as never,
      credentialsRevision: 0,
    });

    expect(useAiProviderStore.getState().restProviders).toHaveLength(1);
  });

  it("drops entries without a valid type and coerces non-string fields", () => {
    applyRemoteAiProviderState(
      payload({
        activeProvider: { evil: true } as never,
        restProviders: [
          { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", model: "gpt-4" },
          { name: "no type" } as never, // dropped: no string `type`
          null as never,
        ],
      }),
    );

    const rest = useAiProviderStore.getState().restProviders;
    expect(rest).toHaveLength(1);
    expect(rest[0].type).toBe("openai");
    // activeProvider was a non-string object → coerced to null.
    expect(useAiProviderStore.getState().activeProvider).toBeNull();
  });
});

describe("useAiProviderSync hook", () => {
  it("registers state + request listeners and requests state on mount", () => {
    renderHook(() => useAiProviderSync());

    expect(listeners.has(AI_PROVIDER_STATE_EVENT)).toBe(true);
    expect(listeners.has(AI_PROVIDER_REQUEST_EVENT)).toBe(true);
    expect(emitMock).toHaveBeenCalledWith(AI_PROVIDER_REQUEST_EVENT);
  });

  it("does not broadcast its own hydration snapshot on mount", () => {
    renderHook(() => useAiProviderSync());

    const stateEmits = emitMock.mock.calls.filter((c) => c[0] === AI_PROVIDER_STATE_EVENT);
    expect(stateEmits).toHaveLength(0);
  });

  it("replies to a peer's state request with the current snapshot", () => {
    renderHook(() => useAiProviderSync());
    emitMock.mockClear();

    act(() => {
      listeners.get(AI_PROVIDER_REQUEST_EVENT)?.({ payload: undefined });
    });

    const stateEmits = emitMock.mock.calls.filter((c) => c[0] === AI_PROVIDER_STATE_EVENT);
    expect(stateEmits).toHaveLength(1);
  });

  it("does NOT echo a snapshot it just applied from a peer", () => {
    // The real echo-suppression check: mount the hook, drive its registered
    // listener with a remote payload, and assert the outbound effect does not
    // re-emit that same state. Deleting the suppression would fail this.
    renderHook(() => useAiProviderSync());
    emitMock.mockClear();

    act(() => {
      listeners.get(AI_PROVIDER_STATE_EVENT)?.({
        payload: payload({ activeProvider: "anthropic" }),
      });
    });

    const stateEmits = emitMock.mock.calls.filter((c) => c[0] === AI_PROVIDER_STATE_EVENT);
    expect(stateEmits).toHaveLength(0);
    // ...but the store DID adopt the peer state (proving the listener ran).
    expect(useAiProviderStore.getState().activeProvider).toBe("anthropic");
  });

  it("broadcasts a genuine local change", () => {
    renderHook(() => useAiProviderSync());
    emitMock.mockClear();

    act(() => {
      useAiProviderStore.setState({ activeProvider: "openai" });
    });

    const stateEmits = emitMock.mock.calls.filter((c) => c[0] === AI_PROVIDER_STATE_EVENT);
    expect(stateEmits).toHaveLength(1);
  });

  it("removes its listeners on unmount", async () => {
    const { unmount } = renderHook(() => useAiProviderSync());
    expect(listeners.size).toBeGreaterThan(0);

    await act(async () => {
      unmount();
      // safeUnlistenAsync awaits the listen promise before calling unlisten.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listeners.size).toBe(0);
  });
});
