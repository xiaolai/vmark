/**
 * bookmarkStore — persisted browser bookmarks (WI-S3.1).
 *
 * Identity is `lib/browser/bookmarkUrl`: path- and query-preserving, fragment-preserving.
 * The v2 plan deduped with the origin guard's `canonicalizeOrigin`, which discards the
 * path — every page on a host would have collapsed into a single bookmark.
 *
 * **Persisted**, unlike browsing history and site permissions, and the difference is the
 * point: a bookmark is an explicit, durable thing the user *asked* to keep. A history is
 * a by-product of using the browser, and standing permission for an AI to click on a site
 * is authority. Those two lapse when VMark quits; this one is supposed to outlive it.
 *
 * **Multi-window reconciliation.** Every window shares one `localStorage` but has its own
 * store instance, so a blind write from window A erases whatever window B added while A
 * was open. Each write therefore re-reads what is on disk and merges by canonical url
 * before persisting. Last-writer-wins *per bookmark*, rather than per whole list.
 *
 * @coordinates-with lib/browser/bookmarkUrl — canonical identity
 * @coordinates-with components/Browser/BookmarksView — renders + opens them
 * @module stores/bookmarkStore
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { canonicalizeBookmarkUrl } from "@/lib/browser/bookmarkUrl";

/** Bump when the persisted shape changes, so a migration can be written rather than
 *  a stale snapshot being guessed at. */
export const BOOKMARKS_SCHEMA_VERSION = 1;

const STORAGE_KEY = "vmark-bookmarks";

export interface Bookmark {
  id: string;
  /** Canonical (see bookmarkUrl). This IS the identity — two bookmarks are the same
   *  bookmark iff these match. */
  url: string;
  title: string;
  addedAt: number;
}

interface BookmarkState {
  bookmarks: Bookmark[];
}

interface BookmarkActions {
  /** Add (or retitle) a bookmark. Returns false if the url cannot be one. */
  add: (url: string, title: string) => boolean;
  remove: (url: string) => void;
  has: (url: string) => boolean;
}

let nextId = 0;
const makeId = () => `bm${++nextId}-${Date.now()}`;

/**
 * What another window has already persisted.
 *
 * Read straight from storage rather than from our own state: our state is a snapshot from
 * whenever this window last hydrated, and the whole problem is what happened since.
 */
function persistedBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { bookmarks?: Bookmark[] } };
    return parsed.state?.bookmarks ?? [];
  } catch {
    // Unreadable storage is not a reason to lose what is in memory.
    return [];
  }
}

/** Union by canonical url, newest-added winning a title conflict. */
function mergeByUrl(mine: Bookmark[], theirs: Bookmark[]): Bookmark[] {
  const byUrl = new Map<string, Bookmark>();
  for (const b of [...theirs, ...mine]) {
    const existing = byUrl.get(b.url);
    if (!existing || b.addedAt >= existing.addedAt) byUrl.set(b.url, b);
  }
  return [...byUrl.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export const useBookmarkStore = create<BookmarkState & BookmarkActions>()(
  persist(
    (set, get) => ({
      bookmarks: [],

      add: (url, title) => {
        const canonical = canonicalizeBookmarkUrl(url);
        if (canonical === null) return false;

        const now = Date.now();
        const mine = get().bookmarks;
        const existing = mine.find((b) => b.url === canonical);
        const next = existing
          ? mine.map((b) => (b.url === canonical ? { ...b, title, addedAt: now } : b))
          : [{ id: makeId(), url: canonical, title, addedAt: now }, ...mine];

        // Merge with whatever another window has written since we hydrated, so our write
        // adds to the shared set instead of replacing it.
        set({ bookmarks: mergeByUrl(next, persistedBookmarks()) });
        return true;
      },

      remove: (url) => {
        const canonical = canonicalizeBookmarkUrl(url);
        if (canonical === null) return;
        const merged = mergeByUrl(get().bookmarks, persistedBookmarks());
        set({ bookmarks: merged.filter((b) => b.url !== canonical) });
      },

      has: (url) => {
        const canonical = canonicalizeBookmarkUrl(url);
        if (canonical === null) return false;
        return get().bookmarks.some((b) => b.url === canonical);
      },
    }),
    {
      name: STORAGE_KEY,
      version: BOOKMARKS_SCHEMA_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
    },
  ),
);
