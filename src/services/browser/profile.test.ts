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
    expect(id).toMatch(/[0-9a-f-]{8,}/i);
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
    s.store.set("vmark.browser.profileId", "existing-id-123");
    expect(getOrCreateProfileId(s)).toBe("existing-id-123");
  });
});
