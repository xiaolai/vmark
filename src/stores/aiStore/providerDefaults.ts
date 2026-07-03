/**
 * Default REST AI provider configs.
 *
 * Extracted from `provider.ts` so the store module stays under the file-size
 * budget. Consumed both as the store's initial `restProviders` and by
 * `onRehydrateStorage` to backfill providers added in newer app versions.
 *
 * @coordinates-with src/stores/aiStore/provider.ts — store initializer + rehydrate backfill
 * @module stores/aiStore/providerDefaults
 */

import type { RestProviderConfig } from "@/types/aiGenies";

export const DEFAULT_REST_PROVIDERS: RestProviderConfig[] = [
  {
    type: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com",
    apiKey: "",
    model: "claude-sonnet-4-5-20250929",
  },
  {
    type: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com",
    apiKey: "",
    model: "gpt-4o",
  },
  {
    // Generic slot for any OpenAI-compatible API (DeepSeek, Groq, OpenRouter,
    // Together, …). Endpoint + model are user-supplied; `name` is editable so
    // the provider list can read "DeepSeek" instead of the generic label.
    type: "openai-compatible",
    name: "OpenAI-compatible",
    endpoint: "",
    apiKey: "",
    model: "",
  },
  {
    type: "google-ai",
    name: "Google AI",
    endpoint: "",
    apiKey: "",
    model: "gemini-2.0-flash",
  },
  {
    type: "ollama-api",
    name: "Ollama (API)",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "llama3.2",
  },
];
