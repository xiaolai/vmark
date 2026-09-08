// @vitest-environment node
// validateProvider — the two refusals that happen BEFORE any Rust call: a CLI
// provider whose binary was not found, and a REST provider with no API key.
// Everything else is deliberately the runner's problem (module header).
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { validateProvider } from "./providerValidation";
import { useAiProviderStore } from "@/stores/aiStore";
import type { RestProviderConfig } from "@/types/aiGenies";

/** Seed the REAL store (mock-boundaries forbids mocking one) and hand it over. */
function stateWith(apiKey: string): ReturnType<typeof useAiProviderStore.getState> {
  const anthropic: RestProviderConfig = {
    type: "anthropic",
    name: "Anthropic",
    endpoint: "",
    apiKey,
    model: "",
  };
  useAiProviderStore.setState({
    activeProvider: "anthropic",
    cliProviders: [],
    restProviders: [anthropic],
  });
  return useAiProviderStore.getState();
}

beforeEach(() => {
  toastErrorMock.mockReset();
});

describe("validateProvider REST key check", () => {
  it("accepts a real key", () => {
    expect(validateProvider(stateWith("sk-real")))
      .not.toBeNull();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("refuses an empty key", () => {
    expect(validateProvider(stateWith(""))).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  // Audit #962 — a whitespace-only key is no key. It used to pass the
  // truthiness test, so the user got a provider-side 401 seconds later instead
  // of the actionable "add an API key in Settings" refusal this check exists for.
  it.each(["   ", "\t", "\n "])("refuses the whitespace-only key %j", (blank) => {
    expect(validateProvider(stateWith(blank))).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});

// Audit #960 — the caller checks first, but `ensureProvider()` awaits, and the
// active provider can be cleared in that window. A silent null is the one
// refusal a user cannot act on: the genie simply does nothing.
describe("validateProvider with no active provider", () => {
  it("refuses, and says so", () => {
    useAiProviderStore.setState({
      activeProvider: null,
      cliProviders: [],
      restProviders: [],
    });

    expect(validateProvider(useAiProviderStore.getState())).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
