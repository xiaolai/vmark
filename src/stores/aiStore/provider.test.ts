// T4 (M1) — validate persisted/3rd-party JSON shape at the secure-store
// migrate boundary instead of a blind `as unknown as` cast.
import { describe, it, expect } from "vitest";
import { sanitizeAiProviderPersist } from "./provider";

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
