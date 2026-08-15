/**
 * Which standalone HTML documents the user has authorized to execute, this
 * session (issue #1273).
 *
 * Purpose: hold the `path -> grant token` map that turns "the user clicked
 * Enable on THIS file" into something the preview can act on. The token itself
 * addresses a document held in Rust (`trusted_html::TrustedHtmlState`); this
 * store owns the association between that token and a file, because a file
 * path is a frontend concept and the backend deliberately never sees one.
 *
 * Three properties this file is responsible for:
 *
 * - **Never persisted.** A plain `create` with no `persist` middleware, so a
 *   document trusted today is untrusted at next launch. Persisted trust is
 *   where this class of feature usually goes wrong (requirement 4), so the
 *   absence is pinned by a test rather than left to reviewer memory.
 * - **Exact-path only.** No prefix, directory or extension matching — a grant
 *   authorizes one file and nothing adjacent to it (requirement 10).
 * - **Pathless documents cannot be trusted.** An untitled buffer has no
 *   identity to attach a grant to, so `grant` refuses rather than inventing
 *   one.
 *
 * @module stores/htmlTrustStore
 */

import { create } from "zustand";

interface HtmlTrustState {
  /** `absolute file path -> trusted_html grant token`. */
  grants: Record<string, string>;
  /** The grant token for `path`, or null when it is not trusted. */
  tokenFor: (path: string | null) => string | null;
  /** Record an authorization. A null or empty path is refused. */
  grant: (path: string | null, token: string) => void;
  /** Drop one authorization. */
  revoke: (path: string | null) => void;
  /** Drop every authorization. */
  clearAll: () => void;
  /** Every live token — for revoking the whole set on teardown. */
  tokens: () => string[];
}

export const useHtmlTrustStore = create<HtmlTrustState>((set, get) => ({
  grants: {},

  tokenFor: (path) => {
    if (!path) return null;
    return get().grants[path] ?? null;
  },

  grant: (path, token) => {
    if (!path) return;
    set((state) => ({ grants: { ...state.grants, [path]: token } }));
  },

  revoke: (path) => {
    if (!path) return;
    set((state) => {
      if (!(path in state.grants)) return state;
      const next = { ...state.grants };
      delete next[path];
      return { grants: next };
    });
  },

  clearAll: () => set({ grants: {} }),

  tokens: () => Object.values(get().grants),
}));
