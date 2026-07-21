/**
 * AI provider sanitization — the zero-trust validation boundary (T4) for
 * untrusted provider blobs, shared by the persist `migrate` path and the
 * cross-window sync path (useAiProviderSync). Extracted from provider.ts so the
 * store definition stays focused; these are pure functions with no store
 * dependency.
 *
 * @coordinates-with stores/aiStore/provider.ts — the store that uses these
 * @coordinates-with hooks/useAiProviderSync.ts — cross-window inbound guard
 * @module stores/aiStore/providerSanitize
 */

import type {
  ProviderType,
  RestProviderConfig,
  RestProviderType,
} from "@/types/aiGenies";

/**
 * Shape-guard one persisted REST provider entry (T4). Coerces missing/
 * wrong-typed string fields to `""` so a tampered or stale secure-store blob
 * can't inject `undefined`/non-string fields downstream. Returns null for
 * entries with no string `type` — the identity key is unusable without it.
 */
function sanitizeRestProvider(raw: unknown): RestProviderConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string") return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    type: r.type as RestProviderType,
    name: str(r.name),
    endpoint: str(r.endpoint),
    apiKey: str(r.apiKey),
    model: str(r.model),
  };
}

/**
 * Validate/normalize the persisted AI-provider blob at the migrate boundary
 * (T4, zero-trust). Replaces a blind `as unknown as AiProviderState` cast:
 * drops a non-array `restProviders` and malformed entries, and coerces
 * `activeProvider` to `string | null`. A fully-malformed blob recovers to
 * defaults (onRehydrateStorage backfills DEFAULT_REST_PROVIDERS).
 */
export function sanitizeAiProviderPersist(data: Record<string, unknown>): {
  activeProvider: ProviderType | null;
  restProviders: RestProviderConfig[];
} {
  const activeProvider =
    typeof data.activeProvider === "string"
      ? (data.activeProvider as ProviderType)
      : null;
  const restProviders = Array.isArray(data.restProviders)
    ? data.restProviders
        .map(sanitizeRestProvider)
        .filter((p): p is RestProviderConfig => p !== null)
    : [];
  return { activeProvider, restProviders };
}

/** REST provider type identifiers that require API key configuration. CLI types are everything else. */
export const REST_TYPES = new Set<string>([
  "anthropic",
  "openai",
  "openai-compatible",
  "google-ai",
  "ollama-api",
]);

/** Ollama API doesn't require an API key. */
export const KEY_OPTIONAL_REST = new Set<string>(["ollama-api"]);
