import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAiProviderStore, REST_TYPES, KEY_OPTIONAL_REST } from "../aiStore";

// Ensure invoke mock returns sane defaults for store initialization
vi.mocked(invoke).mockImplementation(async (cmd: string) => {
  if (cmd === "detect_ai_providers") return [];
  if (cmd === "read_env_api_keys") return {};
  return undefined;
});

describe("aiProviderStore", () => {
  beforeEach(() => {
    useAiProviderStore.setState({
      activeProvider: null,
      cliProviders: [],
      restProviders: [
        { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "", model: "claude-sonnet-4-5-20250929" },
        { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", apiKey: "", model: "gpt-4o" },
        { type: "openai-compatible", name: "OpenAI-compatible", endpoint: "", apiKey: "", model: "" },
        { type: "google-ai", name: "Google AI", endpoint: "", apiKey: "", model: "gemini-2.0-flash" },
        { type: "ollama-api", name: "Ollama (API)", endpoint: "http://localhost:11434", apiKey: "", model: "llama3.2" },
      ],
      detecting: false,
    });
  });

  // ── Initialization ──────────────────────────────────────────────────

  it("initializes with null activeProvider", () => {
    expect(useAiProviderStore.getState().activeProvider).toBeNull();
  });

  it("initializes with empty cliProviders", () => {
    expect(useAiProviderStore.getState().cliProviders).toEqual([]);
  });

  it("initializes with five default REST providers", () => {
    const { restProviders } = useAiProviderStore.getState();
    expect(restProviders).toHaveLength(5);
    expect(restProviders.map((p) => p.type)).toEqual([
      "anthropic",
      "openai",
      "openai-compatible",
      "google-ai",
      "ollama-api",
    ]);
  });

  it("initializes detecting as false", () => {
    expect(useAiProviderStore.getState().detecting).toBe(false);
  });

  // ── activateProvider ───────────────────────────────────────────────

  it("activates a CLI provider", () => {
    useAiProviderStore.getState().activateProvider("claude");
    expect(useAiProviderStore.getState().activeProvider).toBe("claude");
  });

  it("activates a REST provider", () => {
    useAiProviderStore.getState().activateProvider("openai");
    expect(useAiProviderStore.getState().activeProvider).toBe("openai");
  });

  it("can switch active provider", () => {
    useAiProviderStore.getState().activateProvider("claude");
    useAiProviderStore.getState().activateProvider("anthropic");
    expect(useAiProviderStore.getState().activeProvider).toBe("anthropic");
  });

  // ── updateRestProvider ──────────────────────────────────────────────

  it("updates an existing REST provider's apiKey", () => {
    useAiProviderStore.getState().updateRestProvider("anthropic", {
      apiKey: "sk-test-123",
    });
    const provider = useAiProviderStore
      .getState()
      .restProviders.find((p) => p.type === "anthropic");
    expect(provider?.apiKey).toBe("sk-test-123");
  });

  it("updates an existing REST provider's model", () => {
    useAiProviderStore.getState().updateRestProvider("openai", {
      model: "gpt-4-turbo",
    });
    const provider = useAiProviderStore
      .getState()
      .restProviders.find((p) => p.type === "openai");
    expect(provider?.model).toBe("gpt-4-turbo");
  });

  it("does not modify other providers when updating one", () => {
    const before = useAiProviderStore.getState().restProviders.find(
      (p) => p.type === "openai"
    );
    useAiProviderStore.getState().updateRestProvider("anthropic", {
      apiKey: "sk-new",
    });
    const after = useAiProviderStore.getState().restProviders.find(
      (p) => p.type === "openai"
    );
    expect(after).toEqual(before);
  });

  it("no-ops when updating a non-existent provider type", () => {
    const before = useAiProviderStore.getState().restProviders;
    useAiProviderStore.getState().updateRestProvider(
      "nonexistent" as never,
      { apiKey: "x" }
    );
    const after = useAiProviderStore.getState().restProviders;
    // Each provider should remain unchanged
    expect(after.map((p) => p.apiKey)).toEqual(before.map((p) => p.apiKey));
  });

  // ── getActiveProviderName ───────────────────────────────────────────

  it("returns 'None' when no provider is active", () => {
    expect(useAiProviderStore.getState().getActiveProviderName()).toBe("None");
  });

  it("returns CLI provider name when active", () => {
    useAiProviderStore.setState({
      activeProvider: "claude",
      cliProviders: [
        { type: "claude", name: "Claude Code", command: "claude", available: true },
      ],
    });
    expect(useAiProviderStore.getState().getActiveProviderName()).toBe(
      "Claude Code"
    );
  });

  it("returns REST provider name when active", () => {
    useAiProviderStore.setState({ activeProvider: "anthropic" });
    expect(useAiProviderStore.getState().getActiveProviderName()).toBe(
      "Anthropic"
    );
  });

  it("returns raw type string when provider not found in any list", () => {
    useAiProviderStore.setState({
      activeProvider: "unknown-provider" as never,
      cliProviders: [],
    });
    expect(useAiProviderStore.getState().getActiveProviderName()).toBe(
      "unknown-provider"
    );
  });

  // ── Exported constants ──────────────────────────────────────────────

  it("REST_TYPES contains expected types", () => {
    expect(REST_TYPES.has("anthropic")).toBe(true);
    expect(REST_TYPES.has("openai")).toBe(true);
    expect(REST_TYPES.has("google-ai")).toBe(true);
    expect(REST_TYPES.has("ollama-api")).toBe(true);
    expect(REST_TYPES.has("claude")).toBe(false);
  });

  it("KEY_OPTIONAL_REST contains only ollama-api", () => {
    expect(KEY_OPTIONAL_REST.has("ollama-api")).toBe(true);
    expect(KEY_OPTIONAL_REST.size).toBe(1);
  });

  // ── detectProviders ─────────────────────────────────────────────────

  describe("detectProviders", () => {
    it("populates cliProviders from Rust detection", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          return [
            { type: "claude", name: "Claude Code", command: "claude", available: true, path: "/usr/local/bin/claude" },
            { type: "ollama", name: "Ollama", command: "ollama", available: false },
          ];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();

      const { cliProviders, detecting } = useAiProviderStore.getState();
      expect(detecting).toBe(false);
      expect(cliProviders).toHaveLength(2);
      expect(cliProviders[0]).toEqual({
        type: "claude",
        name: "Claude Code",
        command: "claude",
        available: true,
        path: "/usr/local/bin/claude",
      });
      expect(cliProviders[1].available).toBe(false);
    });

    it("auto-selects first available CLI when no active provider", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          return [
            { type: "gemini", name: "Gemini", command: "gemini", available: false },
            { type: "claude", name: "Claude", command: "claude", available: true },
          ];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().activeProvider).toBe("claude");
    });

    it("does not overwrite explicit user selection", async () => {
      useAiProviderStore.setState({ activeProvider: "openai" });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          return [
            { type: "claude", name: "Claude", command: "claude", available: true },
          ];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().activeProvider).toBe("openai");
    });

    it("auto-selects REST provider with API key when no CLI available", async () => {
      useAiProviderStore.setState({
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "sk-key", model: "claude-sonnet-4-5-20250929" },
          { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", apiKey: "", model: "gpt-4o" },
          { type: "google-ai", name: "Google AI", endpoint: "", apiKey: "", model: "gemini-2.0-flash" },
          { type: "ollama-api", name: "Ollama (API)", endpoint: "http://localhost:11434", apiKey: "", model: "llama3.2" },
        ],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") return [];
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().activeProvider).toBe("anthropic");
    });

    it("auto-selects ollama-api (key-optional) as fallback", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") return [];
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      // No CLI available, no REST keys — ollama-api is key-optional
      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().activeProvider).toBe("ollama-api");
    });

    it("sets detecting to false on error", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") throw new Error("detection failed");
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().detecting).toBe(false);
    });

    it("stale check discards result of first call when second call wins (line 133)", async () => {
      // Control resolution order: first call resolves AFTER second call has already
      // incremented _detectId, so the first call's stale check (line 133) triggers.
      let resolveFirst!: (value: unknown) => void;
      let callCount = 0;

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          callCount++;
          if (callCount === 1) {
            // First call: wait until manually resolved (after second call starts)
            await new Promise((r) => { resolveFirst = r; });
            return [{ type: "claude", name: "Claude", command: "claude", available: true }];
          }
          // Second call: resolve immediately with different data
          return [{ type: "gemini", name: "Gemini", command: "gemini", available: false }];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      // Start first call but don't await
      const first = useAiProviderStore.getState().detectProviders();
      // Start second call — this increments _detectId
      const second = useAiProviderStore.getState().detectProviders();
      await second;
      // Now let the first call resolve (it will hit the stale check and return early)
      resolveFirst(undefined);
      await first;

      // The second call's result should be used (gemini), not the first call's (claude)
      const { cliProviders } = useAiProviderStore.getState();
      expect(cliProviders.some((p) => p.type === "gemini")).toBe(true);
    });

    it("stale error is silently ignored (line 165 false branch)", async () => {
      // Trigger a stale detectId scenario in the catch branch:
      // First call throws, but by then a second call has already won.
      let resolveFirst!: (value: unknown) => void;
      let callCount = 0;

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          callCount++;
          if (callCount === 1) {
            // First call: wait, then throw
            await new Promise((r) => { resolveFirst = r; });
            throw new Error("stale error");
          }
          // Second call: resolves immediately
          return [];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      const first = useAiProviderStore.getState().detectProviders();
      const second = useAiProviderStore.getState().detectProviders();
      await second;
      // Now let the first call reject — _detectId has been incremented by second call
      resolveFirst(undefined);
      await first;

      // detecting should be false (set by second call), not reset by stale first's catch
      expect(useAiProviderStore.getState().detecting).toBe(false);
    });

    it("handles empty detection result", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") return [];
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      await useAiProviderStore.getState().detectProviders();
      expect(useAiProviderStore.getState().cliProviders).toEqual([]);
    });
  });

  // ── ensureProvider ────────────────────────────────────────────────

  describe("ensureProvider", () => {
    it("returns true immediately when activeProvider is a REST type", async () => {
      useAiProviderStore.setState({ activeProvider: "anthropic" });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") return [];
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      const result = await useAiProviderStore.getState().ensureProvider();
      expect(result).toBe(true);
    });

    it("triggers detection for CLI provider with empty cliProviders", async () => {
      useAiProviderStore.setState({ activeProvider: "claude", cliProviders: [] });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") {
          return [{ type: "claude", name: "Claude", command: "claude", available: true }];
        }
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      const result = await useAiProviderStore.getState().ensureProvider();
      expect(result).toBe(true);
      expect(useAiProviderStore.getState().cliProviders).toHaveLength(1);
    });

    it("returns true for CLI provider with already-populated cliProviders", async () => {
      useAiProviderStore.setState({
        activeProvider: "claude",
        cliProviders: [
          { type: "claude", name: "Claude", command: "claude", available: true },
        ],
      });

      const result = await useAiProviderStore.getState().ensureProvider();
      expect(result).toBe(true);
    });

    it("returns false when no provider can be selected", async () => {
      // All REST providers have no key, no CLI available
      useAiProviderStore.setState({
        activeProvider: null,
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "", apiKey: "", model: "m" },
        ],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "detect_ai_providers") return [];
        if (cmd === "read_env_api_keys") return {};
        return undefined;
      });

      const result = await useAiProviderStore.getState().ensureProvider();
      // ollama-api is not in restProviders here, so no fallback
      expect(result).toBe(false);
    });
  });

  // ── loadEnvApiKeys ────────────────────────────────────────────────

  describe("loadEnvApiKeys", () => {
    it("fills empty API key fields from environment", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "read_env_api_keys") {
          return { anthropic: "env-key-123", openai: "env-openai-456" };
        }
        if (cmd === "detect_ai_providers") return [];
        return undefined;
      });

      await useAiProviderStore.getState().loadEnvApiKeys();

      const { restProviders } = useAiProviderStore.getState();
      expect(restProviders.find((p) => p.type === "anthropic")?.apiKey).toBe("env-key-123");
      expect(restProviders.find((p) => p.type === "openai")?.apiKey).toBe("env-openai-456");
    });

    it("does not overwrite existing API keys", async () => {
      useAiProviderStore.setState({
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "user-key", model: "m" },
          { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", apiKey: "", model: "gpt-4o" },
          { type: "google-ai", name: "Google AI", endpoint: "", apiKey: "", model: "gemini-2.0-flash" },
          { type: "ollama-api", name: "Ollama (API)", endpoint: "http://localhost:11434", apiKey: "", model: "llama3.2" },
        ],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "read_env_api_keys") {
          return { anthropic: "env-key", openai: "env-openai" };
        }
        if (cmd === "detect_ai_providers") return [];
        return undefined;
      });

      await useAiProviderStore.getState().loadEnvApiKeys();

      const { restProviders } = useAiProviderStore.getState();
      // User key preserved
      expect(restProviders.find((p) => p.type === "anthropic")?.apiKey).toBe("user-key");
      // Empty field filled
      expect(restProviders.find((p) => p.type === "openai")?.apiKey).toBe("env-openai");
    });

    it("handles error gracefully", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "read_env_api_keys") throw new Error("env read failed");
        if (cmd === "detect_ai_providers") return [];
        return undefined;
      });

      // Should not throw
      await useAiProviderStore.getState().loadEnvApiKeys();

      // State unchanged
      const { restProviders } = useAiProviderStore.getState();
      expect(restProviders.find((p) => p.type === "anthropic")?.apiKey).toBe("");
    });

    it("ignores env keys for providers not in the list", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "read_env_api_keys") {
          return { "nonexistent-provider": "some-key" };
        }
        if (cmd === "detect_ai_providers") return [];
        return undefined;
      });

      await useAiProviderStore.getState().loadEnvApiKeys();

      // All keys should remain empty
      const { restProviders } = useAiProviderStore.getState();
      for (const p of restProviders) {
        expect(p.apiKey).toBe("");
      }
    });
  });

  // ── updateRestProvider (additional) ───────────────────────────────

  it("updates multiple fields at once", () => {
    useAiProviderStore.getState().updateRestProvider("openai", {
      apiKey: "new-key",
      model: "gpt-4-turbo",
      endpoint: "https://custom.openai.com",
    });
    const provider = useAiProviderStore.getState().restProviders.find((p) => p.type === "openai");
    expect(provider?.apiKey).toBe("new-key");
    expect(provider?.model).toBe("gpt-4-turbo");
    expect(provider?.endpoint).toBe("https://custom.openai.com");
  });

  // ── migrate ────────────────────────────────────────────────────────

  describe("persist migrate", () => {
    it("strips enabled field from REST providers when migrating from v1", () => {
      const options = useAiProviderStore.persist.getOptions();
      const migrate = options.migrate!;
      const v1Data = {
        activeProvider: "anthropic",
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "", apiKey: "k", model: "m", enabled: true },
          { type: "openai", name: "OpenAI", endpoint: "", apiKey: "", model: "m", enabled: false },
        ],
      };
      const result = migrate(v1Data, 1) as Record<string, unknown>;
      const providers = result.restProviders as Array<Record<string, unknown>>;
      expect(providers[0]).not.toHaveProperty("enabled");
      expect(providers[1]).not.toHaveProperty("enabled");
      expect(providers[0].apiKey).toBe("k");
    });

    it("skips migration when version is already 2", () => {
      const options = useAiProviderStore.persist.getOptions();
      const migrate = options.migrate!;
      const v2Data = {
        activeProvider: null,
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "", apiKey: "", model: "m" },
        ],
      };
      const result = migrate(v2Data, 2) as Record<string, unknown>;
      expect(result).toEqual(v2Data);
    });

    it("handles v1 data with no restProviders array", () => {
      const options = useAiProviderStore.persist.getOptions();
      const migrate = options.migrate!;
      const v1Data = { activeProvider: null };
      const result = migrate(v1Data, 1) as Record<string, unknown>;
      expect(result.activeProvider).toBeNull();
    });
  });

  // ── onRehydrateStorage ────────────────────────────────────────────

  describe("persist onRehydrateStorage", () => {
    it("merges new default REST providers after rehydration", () => {
      // Simulate a state with only 2 of the 5 default providers
      useAiProviderStore.setState({
        restProviders: [
          { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "", model: "claude-sonnet-4-5-20250929" },
          { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", apiKey: "", model: "gpt-4o" },
        ],
      });

      const options = useAiProviderStore.persist.getOptions();
      const onRehydrate = options.onRehydrateStorage!;
      const postHydrate = onRehydrate(useAiProviderStore.getState());

      // Call the post-hydrate callback
      postHydrate!();

      const { restProviders } = useAiProviderStore.getState();
      const types = restProviders.map((p) => p.type);
      expect(types).toContain("google-ai");
      expect(types).toContain("ollama-api");
    });

    it("does not duplicate existing providers on rehydration", () => {
      // All 5 defaults already present (incl. the openai-compatible slot)
      const options = useAiProviderStore.persist.getOptions();
      const onRehydrate = options.onRehydrateStorage!;
      const postHydrate = onRehydrate(useAiProviderStore.getState());
      postHydrate!();

      const { restProviders } = useAiProviderStore.getState();
      expect(restProviders).toHaveLength(5);
    });
  });

  // ── SSR guard ───────────────────────────────────────────────────────

  it("store is functional (SSR guard does not break initialization)", () => {
    const state = useAiProviderStore.getState();
    expect(state.activeProvider).toBeDefined();
    expect(typeof state.activateProvider).toBe("function");
    expect(typeof state.updateRestProvider).toBe("function");
    expect(typeof state.getActiveProviderName).toBe("function");
    expect(typeof state.detectProviders).toBe("function");
    expect(typeof state.ensureProvider).toBe("function");
    expect(typeof state.loadEnvApiKeys).toBe("function");
  });
});
