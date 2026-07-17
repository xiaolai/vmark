/**
 * Content no-op suppression — drop events whose content did not actually change.
 *
 * Purpose: The async filter that upgrades the layer's signal from "a path was
 *   touched" to "content actually changed". Reads each text create/modify,
 *   fingerprints it (via the {@link ContentHashCache}), and drops the event
 *   when the fingerprint matches the last-known one — catching external touches,
 *   no-op formatter rewrites, and reverts-to-identical that would otherwise storm
 *   consumers. Injected reader/hash/media-probe (mirrors hooks/fsChangeHandlers)
 *   so it unit-tests without Tauri.
 *
 * Safety direction: anything that cannot be verified (media, unreadable file,
 *   first sighting) is *kept*, never suppressed — a false "changed" is cheap; a
 *   missed real edit is not.
 *
 * @coordinates-with services/workspaceEvents/contentHashCache — the fingerprint store
 * @coordinates-with services/workspaceEvents/workspaceEventBus — attachFsSource wires this in
 * @module services/workspaceEvents/suppressUnchanged
 */

import type { ContentHashCache } from "./contentHashCache";
import type { SemanticWorkspaceEvent } from "./types";

/** Injected collaborators for the suppression pass. */
export interface SuppressDeps {
  /** Last-known content fingerprints (mutated as files are seen). */
  cache: ContentHashCache;
  /** Read a file as text; rejects if gone/unreadable. */
  readText: (path: string) => Promise<string>;
  /** Fingerprint content for equality comparison. */
  hash: (content: string) => string;
  /** True for binary media — never read as UTF-8, always passes through. */
  isMedia: (path: string) => boolean;
}

/** Decide whether to keep one event, updating the cache as a side effect. */
async function keepEvent(event: SemanticWorkspaceEvent, deps: SuppressDeps): Promise<boolean> {
  const { cache, readText, hash, isMedia } = deps;

  if (event.kind === "deleted") {
    cache.forget(event.path);
    return true;
  }
  if (event.kind === "renamed") {
    if (event.previousPath) cache.rename(event.previousPath, event.path);
    else cache.forget(event.path);
    return true;
  }

  // created / modified
  if (isMedia(event.path)) return true; // binary — cannot fingerprint here

  let content: string;
  try {
    content = await readText(event.path);
  } catch {
    // Unreadable (gone mid-read, locked): re-baseline and keep — never suppress
    // what we could not verify.
    cache.forget(event.path);
    return true;
  }

  const next = hash(content);
  const known = cache.get(event.path);
  cache.set(event.path, next);
  return !(known !== undefined && known === next);
}

/**
 * Filter a batch, dropping create/modify events whose content is byte-identical
 * to the last time we saw the path. Deletes and renames are always kept (and
 * keep the cache honest). Order is preserved.
 */
export async function suppressUnchanged(
  events: SemanticWorkspaceEvent[],
  deps: SuppressDeps,
): Promise<SemanticWorkspaceEvent[]> {
  const kept: SemanticWorkspaceEvent[] = [];
  for (const event of events) {
    if (await keepEvent(event, deps)) kept.push(event);
  }
  return kept;
}
