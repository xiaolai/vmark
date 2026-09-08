// @vitest-environment node
/**
 * The `run_workflow` provider block (audit #762).
 *
 * It had two implementations — `useGenieInvocation`'s `workflowProviderConfig`
 * and the body of `useWorkflowExecution.start` — building the same four fields
 * from the same store for the same command. These pin the rules that were
 * duplicated, in particular the `|| null` fold that turns an empty string into
 * "not configured".
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useAiProviderStore } from "@/stores/aiStore";
import { workflowProviderPayload } from "./providerPayload";

beforeEach(() => {
  useAiProviderStore.setState({
    activeProvider: null,
    restProviders: [],
    cliProviders: [],
  } as never);
});

describe("workflowProviderPayload", () => {
  it("is null when no provider is active", () => {
    expect(workflowProviderPayload()).toBeNull();
  });

  it("carries a REST provider's key and endpoint", () => {
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [{ type: "openai", apiKey: "sk-1", endpoint: "https://api" }],
      cliProviders: [],
    } as never);

    expect(workflowProviderPayload()).toEqual({
      provider: "openai",
      apiKey: "sk-1",
      endpoint: "https://api",
      cliPath: null,
    });
  });

  it("carries a CLI provider's resolved path", () => {
    useAiProviderStore.setState({
      activeProvider: "claude",
      restProviders: [],
      cliProviders: [{ type: "claude", path: "/usr/local/bin/claude" }],
    } as never);

    expect(workflowProviderPayload()).toEqual({
      provider: "claude",
      apiKey: null,
      endpoint: null,
      cliPath: "/usr/local/bin/claude",
    });
  });

  // The fold both copies used, kept deliberately: an empty string is not a
  // configured value, and Rust reads `null` as "not set".
  it.each([
    ["", null],
    ["   ", "   "],
  ])("folds an apiKey of %j to %j", (apiKey, expected) => {
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [{ type: "openai", apiKey, endpoint: "" }],
      cliProviders: [],
    } as never);

    expect(workflowProviderPayload()?.apiKey).toBe(expected);
    expect(workflowProviderPayload()?.endpoint).toBeNull();
  });

  it("ignores entries for a provider that is not the active one", () => {
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [{ type: "anthropic", apiKey: "sk-other", endpoint: "https://other" }],
      cliProviders: [{ type: "claude", path: "/bin/claude" }],
    } as never);

    expect(workflowProviderPayload()).toEqual({
      provider: "openai",
      apiKey: null,
      endpoint: null,
      cliPath: null,
    });
  });
});
