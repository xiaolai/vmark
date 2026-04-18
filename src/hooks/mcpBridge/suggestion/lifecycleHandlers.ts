/**
 * suggestion.* lifecycle handlers — accept / reject / list / acceptAll / rejectAll.
 *
 * All operations act on entries in `aiSuggestionStore`.
 *
 * @module hooks/mcpBridge/suggestion/lifecycleHandlers
 */

import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { respond } from "../utils";
import { requireString } from "../validateArgs";

/** Accept a specific suggestion by ID. */
export async function handleSuggestionAccept(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const suggestionId = requireString(args, "suggestionId");

    const store = useAiSuggestionStore.getState();
    const suggestion = store.getSuggestion(suggestionId);

    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    store.acceptSuggestion(suggestionId);

    await respond({
      id,
      success: true,
      data: { message: "Suggestion accepted", suggestionId },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Reject a specific suggestion by ID. */
export async function handleSuggestionReject(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const suggestionId = requireString(args, "suggestionId");

    const store = useAiSuggestionStore.getState();
    const suggestion = store.getSuggestion(suggestionId);

    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    store.rejectSuggestion(suggestionId);

    await respond({
      id,
      success: true,
      data: { message: "Suggestion rejected", suggestionId },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Return all pending suggestions. */
export async function handleSuggestionList(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const suggestions = store.getSortedSuggestions().map((s) => ({
      id: s.id,
      type: s.type,
      from: s.from,
      to: s.to,
      newContent: s.newContent,
      originalContent: s.originalContent,
      createdAt: s.createdAt,
    }));

    await respond({
      id,
      success: true,
      data: {
        suggestions,
        count: suggestions.length,
        focusedId: store.focusedSuggestionId,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Accept all pending suggestions. */
export async function handleSuggestionAcceptAll(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const count = store.suggestions.size;

    store.acceptAll();

    await respond({
      id,
      success: true,
      data: { message: `Accepted ${count} suggestions`, count },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Reject all pending suggestions. */
export async function handleSuggestionRejectAll(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const count = store.suggestions.size;

    store.rejectAll();

    await respond({
      id,
      success: true,
      data: { message: `Rejected ${count} suggestions`, count },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
