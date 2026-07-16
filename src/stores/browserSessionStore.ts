/**
 * Browser session/profile registry (WI-P6.4/P6.5) — the frontend's metadata-only
 * index of saved sessions and named profiles, so the management UI can LIST them.
 *
 * The actual credential blobs live in the OS keychain (session_state.rs) and named
 * WebKit stores, neither of which can be enumerated — hence this registry. It holds
 * **no credential values**: only a handle/profile name, a value-free count summary
 * (from `redacted_summary`), and a timestamp.
 *
 * @coordinates-with hooks/mcpBridge/v2/browserSession.ts — records a session on save
 * @coordinates-with hooks/mcpBridge/v2/browserNavigation.ts — records a profile on open
 * @module stores/browserSessionStore
 */

import { create } from "zustand";

/** A saved session — a handle + a value-free summary, never any values. */
export interface SavedSession {
  handle: string;
  summary: string;
  savedAt: number;
}

/** A named persistent profile the user has used. */
export interface NamedProfile {
  name: string;
  usedAt: number;
}

interface BrowserSessionState {
  sessions: SavedSession[];
  profiles: NamedProfile[];
}

interface BrowserSessionActions {
  recordSession: (handle: string, summary: string, savedAt: number) => void;
  forgetSession: (handle: string) => void;
  recordProfileUse: (name: string, usedAt: number) => void;
  removeProfile: (name: string) => void;
}

export const useBrowserSessionStore = create<BrowserSessionState & BrowserSessionActions>(
  (set) => ({
    sessions: [],
    profiles: [],

    recordSession: (handle, summary, savedAt) =>
      set((state) => ({
        sessions: [...state.sessions.filter((s) => s.handle !== handle), { handle, summary, savedAt }],
      })),

    forgetSession: (handle) =>
      set((state) => ({ sessions: state.sessions.filter((s) => s.handle !== handle) })),

    recordProfileUse: (name, usedAt) =>
      set((state) => ({
        profiles: [...state.profiles.filter((p) => p.name !== name), { name, usedAt }],
      })),

    removeProfile: (name) =>
      set((state) => ({ profiles: state.profiles.filter((p) => p.name !== name) })),
  }),
);
