/**
 * AI Store — public API barrel.
 *
 * Re-exports the 5 AI-related stores from their per-domain files in
 * `./aiStore/`. The split keeps each file under the ~300 LOC guideline
 * while preserving the consolidated import path that consumers and test
 * mocks rely on:
 *
 *   import { useGeniesStore } from "@/stores/aiStore";
 *
 * Each underlying file owns one Zustand instance plus its persist
 * config. Public types/types-only imports flow through this barrel too.
 *
 * @module stores/aiStore
 */

export { useAiInvocationStore } from "./aiStore/invocation";
export {
  useAiProviderStore,
  REST_TYPES,
  KEY_OPTIONAL_REST,
} from "./aiStore/provider";
export {
  useAiSuggestionStore,
  resetAiSuggestionStore,
  initSuggestionTabWatcher,
} from "./aiStore/suggestion";
export { useGeniesStore } from "./aiStore/genies";
export { usePromptHistoryStore } from "./aiStore/promptHistory";
