/**
 * Curated model suggestions per REST AI provider.
 *
 * Ollama models are fetched dynamically — the static list is empty.
 */

import type { RestProviderType } from "@/types/aiGenies";

export const MODEL_SUGGESTIONS: Record<RestProviderType, string[]> = {
  anthropic: [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
  ],
  // Generic OpenAI-compatible provider — models vary by vendor, so there is
  // no meaningful curated list. Users type the model or fetch it via the
  // refresh button (backend `list_models` returns the endpoint's `/v1/models`).
  "openai-compatible": [],
  "google-ai": [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
  ],
  "ollama-api": [],
};
