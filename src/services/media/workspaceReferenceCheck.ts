/**
 * Workspace Reference Check (WI-11)
 *
 * Purpose: the last line of defence before an image is trashed — ask the
 * workspace content search whether ANY document, anywhere in the workspace,
 * mentions the candidate's filename.
 *
 * The sibling scan only reads documents in the asset's own directory, but a
 * document anywhere can legitimately reference `/notes/assets/images/x.png`
 * by absolute path, or `../assets/images/x.png` from a subdirectory. Those
 * documents were invisible, so their images were deleted.
 *
 * Key decisions:
 *   - The probe is the FILENAME as a literal substring, case-insensitive.
 *     Generated names (`shot-1785...-abc123.png`) are effectively unique; a
 *     prose mention of a hand-named file is a false positive that PROTECTS —
 *     the safe direction. A missed reference deletes a rendered image; a
 *     stray mention costs a stray file.
 *   - Fail CLOSED: a search error, or a filename too short to search, keeps
 *     the file. Only a clean "no document mentions this" clears deletion.
 *   - Outside workspace mode there is no index to consult; the caller's
 *     same-directory scan is then the whole story (documented limitation).
 *
 * @coordinates-with orphanAssetCleanup.ts — candidates come from its scan
 * @coordinates-with src-tauri/src/content_search.rs — the search command
 * @module services/media/workspaceReferenceCheck
 */

import { invoke } from "@tauri-apps/api/core";
import { listFormats } from "@/lib/formats/registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { orphanCleanupError } from "@/utils/debug";
import type { OrphanedImage } from "@/services/media/orphanAssetCleanup";

/** Mirror of the Rust FileSearchResult — only `path` matters here. */
interface FileSearchResult {
  path: string;
}

/** The Rust command rejects queries under 3 characters. */
const MIN_QUERY_LENGTH = 3;

/**
 * The extension list is REQUIRED alongside markdownOnly: the Rust side gates
 * on `matches_extensions`, and an empty list matches NOTHING — every search
 * would return zero hits and this check would silently clear everything,
 * which is precisely the failure mode it exists to prevent. Falls back to the
 * markdown family when the registry has not bootstrapped (early close).
 */
function searchableExtensions(): string[] {
  try {
    const exts = listFormats()
      .filter((f) => f.adapters.contentSearchIndexed === true)
      .flatMap((f) => f.extensions.map((ext) => `.${ext}`));
    if (exts.length > 0) return exts;
  } catch {
    // registry not bootstrapped — fall through
  }
  return [".md", ".markdown", ".mdown", ".mkd", ".mdx"];
}

/**
 * Filter `candidates` down to the ones NO workspace document mentions.
 * Anything mentioned anywhere — or unverifiable — is kept out of the
 * deletion set.
 */
export async function withoutWorkspaceReferenced(
  candidates: OrphanedImage[]
): Promise<OrphanedImage[]> {
  if (candidates.length === 0) return candidates;

  const { rootPath, isWorkspaceMode } = useWorkspaceStore.getState();
  if (!isWorkspaceMode || !rootPath) return candidates;

  const cleared: OrphanedImage[] = [];
  for (const candidate of candidates) {
    if (candidate.filename.trim().length < MIN_QUERY_LENGTH) {
      continue; // unverifiable — keep the file (fail closed)
    }
    try {
      const hits = await invoke<FileSearchResult[]>("search_workspace_content", {
        rootPath,
        query: candidate.filename,
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        markdownOnly: true,
        extensions: searchableExtensions(),
        excludeFolders: [],
      });
      if (hits.length === 0) cleared.push(candidate);
      // Any hit — even prose — protects. See the header for why.
    } catch (error) {
      orphanCleanupError(` Workspace reference check failed for ${candidate.filename}:`, error);
      // Fail closed: an unverifiable candidate is kept.
    }
  }
  return cleared;
}
