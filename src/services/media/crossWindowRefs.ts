/**
 * Cross-Window Live References (WI-9)
 *
 * Purpose: the frontend half of the cross-window bridge. Zustand state is
 * per-webview, so another VMark window's unsaved buffer — possibly the SOLE
 * reference to an image — is invisible to this window's cleanup scan. Rust
 * relays a request to every other document window; each answers with the
 * reference keys extracted from its live buffers.
 *
 * Key decisions:
 *   - FAIL CLOSED end to end: a failed invoke, a malformed reply, or any
 *     window missing the deadline yields `complete: false`, which the scanner
 *     folds into `scanComplete: false` — and nothing is deleted on partial
 *     evidence. The single-window common case is a complete empty answer.
 *   - The responder flushes its editors before reading the store (WI-10
 *     applies across windows too) and sends extracted KEYS, not contents —
 *     parsing happens where the buffer lives, and the IPC stays small.
 *
 * @coordinates-with src-tauri/src/live_docs.rs — the relay
 * @coordinates-with hooks/useLiveDocsResponder.ts — the answering side
 * @coordinates-with orphanAssetCleanup.ts — consumes via externalRefKeys
 * @module services/media/crossWindowRefs
 */

import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { extractImageReferenceKeys } from "@/utils/imageReferences";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { orphanCleanupError } from "@/utils/debug";

/** External reference evidence, as the scanner consumes it. */
export interface ExternalRefKeys {
  /** False when any window could not be heard from — delete nothing. */
  complete: boolean;
  keys: ReadonlySet<string>;
}

/** Shape returned by the Rust `collect_live_document_refs` command. */
interface LiveDocRefsWire {
  complete: boolean;
  refs: string[];
}

/**
 * Ask every OTHER document window for its live image-reference keys.
 * Never throws; failure is `complete: false`.
 */
export async function collectRemoteLiveRefs(windowLabel: string): Promise<ExternalRefKeys> {
  try {
    const wire = await invoke<LiveDocRefsWire>("collect_live_document_refs", {
      requestingLabel: windowLabel,
    });
    if (!wire || typeof wire.complete !== "boolean" || !Array.isArray(wire.refs)) {
      return { complete: false, keys: new Set() };
    }
    return { complete: wire.complete, keys: new Set(wire.refs) };
  } catch (error) {
    orphanCleanupError(" Cross-window reference collection failed:", error);
    return { complete: false, keys: new Set() };
  }
}

/**
 * This window's answer: reference keys from every open document's live
 * buffer, editors flushed first. Exported for the responder hook and tests.
 *
 * UNTITLED documents count too: a never-saved buffer can hold an
 * absolute-path reference (drag-drop, MCP write), and it exists nowhere on
 * disk for any other evidence source to find. Extra keys only protect.
 */
export function localLiveRefKeys(): string[] {
  flushAllWysiwygNow();
  const keys = new Set<string>();
  const { documents } = useDocumentStore.getState();
  for (const doc of Object.values(documents)) {
    for (const key of extractImageReferenceKeys(doc.content)) keys.add(key);
  }
  return [...keys];
}
