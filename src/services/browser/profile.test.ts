// WI-1.5 / ADR-B4 — browser profile: data-store mode by macOS version + stable id
import { describe, it, expect } from "vitest";
import {
  selectDataStoreMode,
  getOrCreateProfileId,
  MIN_IDENTIFIED_STORE_MACOS,
  type ProfileStorage,
} from "./profile";

describe("selectDataStoreMode", () => {
  it("uses an identified (persistent, isolated) store on macOS 14+", () => {
    expect(selectDataStoreMode(14)).toBe("identified");
    expect(selectDataStoreMode(15)).toBe("identified");
    expect(selectDataStoreMode(26)).toBe("identified");
  });

  it("falls back to the default store below macOS 14 (dataStoreForIdentifier crashes there)", () => {
    expect(selectDataStoreMode(13)).toBe("default");
    expect(selectDataStoreMode(11)).toBe("default");
  });

  it("exposes the version floor as a constant", () => {
    expect(MIN_IDENTIFIED_STORE_MACOS).toBe(14);
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("getOrCreateProfileId", () => {
  function memStorage(): ProfileStorage & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
    };
  }

  it("generates and persists a stable id on first use", () => {
    const s = memStorage();
    const id = getOrCreateProfileId(s);
    expect(id).toMatch(UUID_RE);
    expect(s.store.size).toBe(1);
  });

  it("returns the same id on subsequent calls (persistent profile)", () => {
    const s = memStorage();
    const first = getOrCreateProfileId(s);
    const second = getOrCreateProfileId(s);
    expect(second).toBe(first);
  });

  it("honors a pre-existing persisted id", () => {
    const s = memStorage();
    const persisted = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    s.store.set("vmark.browser.profileId", persisted);
    expect(getOrCreateProfileId(s)).toBe(persisted);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not a uuid", "existing-id-123"],
    ["truncated uuid", "3f2504e0-4f89-41d3-9a0c"],
    ["uuid with padding", " 3f2504e0-4f89-41d3-9a0c-0305e82c3301 "],
  ])("replaces a corrupt persisted id (%s) with a fresh UUID", (_label, corrupt) => {
    // The id is handed to `dataStoreForIdentifier`, which takes a UUID — a
    // malformed value would fail profile initialization, so regenerate instead.
    const s = memStorage();
    s.store.set("vmark.browser.profileId", corrupt);
    const id = getOrCreateProfileId(s);
    expect(id).toMatch(UUID_RE);
    expect(s.store.get("vmark.browser.profileId")).toBe(id); // repaired in storage
    expect(getOrCreateProfileId(s)).toBe(id); // and stable afterwards
  });

  it("still yields a usable id when storage cannot be read (private mode / denied)", () => {
    const s: ProfileStorage = {
      get: () => {
        throw new Error("SecurityError: storage denied");
      },
      set: () => {},
    };
    expect(getOrCreateProfileId(s)).toMatch(UUID_RE);
  });

  it("still yields a usable id when storage cannot be written (quota exceeded)", () => {
    // A non-persistable id must not abort browser init — the profile is simply
    // not stable across restarts, which beats no browser at all.
    const s: ProfileStorage = {
      get: () => null,
      set: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(getOrCreateProfileId(s)).toMatch(UUID_RE);
  });

  it("falls back to a v4-shaped id when crypto.randomUUID is unavailable", () => {
    const original = globalThis.crypto;
    // Force the no-crypto fallback path.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const id = getOrCreateProfileId(memStorage());
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
