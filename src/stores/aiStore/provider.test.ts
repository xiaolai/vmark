// T4 (M1) — validate persisted/3rd-party JSON shape at the secure-store
// migrate boundary instead of a blind `as unknown as` cast.
// RW-16 (L8) — API keys persist to the OS keychain, not the plaintext store:
// partialize strips keys, and hydrateAndMigrateApiKeys migrates + hydrates.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  sanitizeAiProviderPersist,
  hydrateAndMigrateApiKeys,
  useAiProviderStore,
} from "./provider";

const mockInvoke = vi.mocked(invoke);

describe("sanitizeAiProviderPersist (T4 persist-boundary guard)", () => {
  it("keeps a well-formed persisted blob", () => {
    const out = sanitizeAiProviderPersist({
      activeProvider: "anthropic",
      restProviders: [
        {
          type: "anthropic",
          name: "Anthropic",
          endpoint: "https://api.anthropic.com",
          apiKey: "sk-secret",
          model: "claude-sonnet-4-5",
        },
      ],
    });
    expect(out.activeProvider).toBe("anthropic");
    expect(out.restProviders).toHaveLength(1);
    expect(out.restProviders[0].apiKey).toBe("sk-secret");
  });

  it("coerces a non-string activeProvider to null", () => {
    expect(sanitizeAiProviderPersist({ activeProvider: 42 }).activeProvider).toBeNull();
    expect(sanitizeAiProviderPersist({}).activeProvider).toBeNull();
  });

  it("drops restProviders when it is not an array", () => {
    expect(sanitizeAiProviderPersist({ restProviders: "evil" }).restProviders).toEqual([]);
    expect(sanitizeAiProviderPersist({ restProviders: { type: "x" } }).restProviders).toEqual([]);
  });

  it("drops entries with no string `type` (the identity key)", () => {
    const out = sanitizeAiProviderPersist({
      restProviders: [{ name: "no type" }, { type: 5 }, { type: "openai", name: "OpenAI" }],
    });
    expect(out.restProviders).toHaveLength(1);
    expect(out.restProviders[0].type).toBe("openai");
  });

  it("coerces missing/wrong-typed string fields to empty strings (no undefined leaks)", () => {
    const out = sanitizeAiProviderPersist({
      restProviders: [{ type: "openai", name: 123, apiKey: null }],
    });
    expect(out.restProviders[0]).toEqual({
      type: "openai",
      name: "",
      endpoint: "",
      apiKey: "",
      model: "",
    });
  });
});

describe("hydrateAndMigrateApiKeys (RW-16 keychain hydration + migration)", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Minimal two-provider state; one carries a legacy plaintext key.
    useAiProviderStore.setState({
      restProviders: [
        {
          type: "anthropic",
          name: "Anthropic",
          endpoint: "https://api.anthropic.com",
          apiKey: "sk-legacy-anthropic", // survived from old plaintext blob
          model: "claude",
        },
        {
          type: "openai",
          name: "OpenAI",
          endpoint: "https://api.openai.com",
          apiKey: "",
          model: "gpt-4o",
        },
      ],
    });
  });

  it("migrates a plaintext key to the keychain then hydrates from it", async () => {
    // Stateful fake keychain so set_secret is observable by later get_secret.
    // Migration: pre-check (empty) → set → verify; then hydration reads back.
    const keychain: Record<string, string> = {};
    mockInvoke.mockImplementation(async (cmd, args) => {
      const a = args as { key?: string; value?: string };
      if (cmd === "set_secret") {
        keychain[a.key as string] = a.value as string;
        return undefined;
      }
      if (cmd === "get_secret") return keychain[a.key as string] ?? null;
      return undefined;
    });

    await hydrateAndMigrateApiKeys();

    // anthropic key moved into the (fake) keychain and back into memory.
    expect(keychain["apikey.anthropic"]).toBe("sk-legacy-anthropic");
    const state = useAiProviderStore.getState();
    expect(state.restProviders.find((p) => p.type === "anthropic")?.apiKey).toBe(
      "sk-legacy-anthropic"
    );
    expect(state.restProviders.find((p) => p.type === "openai")?.apiKey).toBe("");
  });

  it("hydrates an existing keychain key without a legacy value present", async () => {
    // No plaintext keys in memory; keychain already holds openai's key.
    useAiProviderStore.setState({
      restProviders: [
        {
          type: "openai",
          name: "OpenAI",
          endpoint: "https://api.openai.com",
          apiKey: "",
          model: "gpt-4o",
        },
      ],
    });
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "get_secret") {
        return (args as { key: string }).key === "apikey.openai"
          ? "sk-from-keychain"
          : null;
      }
      return undefined;
    });

    await hydrateAndMigrateApiKeys();

    expect(
      useAiProviderStore.getState().restProviders.find((p) => p.type === "openai")
        ?.apiKey
    ).toBe("sk-from-keychain");
    // No migration write happened — nothing to migrate.
    expect(mockInvoke).not.toHaveBeenCalledWith("set_secret", expect.anything());
  });

  it("keeps in-memory key empty when keychain has none", async () => {
    useAiProviderStore.setState({
      restProviders: [
        {
          type: "openai",
          name: "OpenAI",
          endpoint: "https://api.openai.com",
          apiKey: "",
          model: "gpt-4o",
        },
      ],
    });
    mockInvoke.mockResolvedValue(null);

    await hydrateAndMigrateApiKeys();

    expect(
      useAiProviderStore.getState().restProviders.find((p) => p.type === "openai")
        ?.apiKey
    ).toBe("");
  });
});
