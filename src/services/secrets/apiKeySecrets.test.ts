// RW-16 (L8) — API-key keychain bridge: command wiring + idempotent,
// non-destructive migration of plaintext keys into the OS keychain.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  apiKeySecretId,
  readApiKey,
  getApiKey,
  setApiKey,
  deleteApiKey,
  loadApiKeys,
  loadApiKeysWithStatus,
  migrateLegacyApiKeys,
} from "./apiKeySecrets";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("apiKeySecretId", () => {
  it("namespaces the key by provider type", () => {
    expect(apiKeySecretId("anthropic")).toBe("apikey.anthropic");
    expect(apiKeySecretId("openai")).toBe("apikey.openai");
  });
});

describe("readApiKey (strict tri-state reader)", () => {
  it("returns present + value when the keychain has a value", async () => {
    mockInvoke.mockResolvedValueOnce("sk-secret");
    await expect(readApiKey("anthropic")).resolves.toEqual({
      status: "present",
      value: "sk-secret",
    });
  });

  it("returns absent when the command returns null (no entry)", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await expect(readApiKey("openai")).resolves.toEqual({
      status: "absent",
      value: "",
    });
  });

  it("returns error (not absent) when the read rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(readApiKey("openai")).resolves.toEqual({
      status: "error",
      value: "",
    });
  });
});

describe("getApiKey", () => {
  it("returns the stored value", async () => {
    mockInvoke.mockResolvedValueOnce("sk-secret");
    await expect(getApiKey("anthropic")).resolves.toBe("sk-secret");
    expect(mockInvoke).toHaveBeenCalledWith("get_secret", {
      key: "apikey.anthropic",
    });
  });

  it("returns empty string when the key is unset (null)", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await expect(getApiKey("openai")).resolves.toBe("");
  });

  it("returns empty string (does not throw) on a command error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(getApiKey("openai")).resolves.toBe("");
  });
});

describe("setApiKey", () => {
  it("calls set_secret for a non-empty value and returns true", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await expect(setApiKey("anthropic", "sk-123")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_secret", {
      key: "apikey.anthropic",
      value: "sk-123",
    });
  });

  it("deletes the entry when the value is empty (no stale secret)", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await expect(setApiKey("anthropic", "")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("delete_secret", {
      key: "apikey.anthropic",
    });
  });

  it("returns false (does not throw) on a command error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    await expect(setApiKey("anthropic", "x")).resolves.toBe(false);
  });
});

describe("deleteApiKey", () => {
  it("calls delete_secret", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteApiKey("openai");
    expect(mockInvoke).toHaveBeenCalledWith("delete_secret", {
      key: "apikey.openai",
    });
  });
});

describe("loadApiKeys", () => {
  it("reads multiple types and omits empty results", async () => {
    mockInvoke.mockImplementation(async (_cmd, args) => {
      const key = (args as { key: string }).key;
      if (key === "apikey.anthropic") return "sk-a";
      return null; // openai unset
    });
    const out = await loadApiKeys(["anthropic", "openai"]);
    expect(out).toEqual({ anthropic: "sk-a" });
  });
});

describe("loadApiKeysWithStatus (status-aware bulk read)", () => {
  it("reports present / absent / error per type distinctly", async () => {
    mockInvoke.mockImplementation(async (_cmd, args) => {
      const key = (args as { key: string }).key;
      if (key === "apikey.anthropic") return "sk-a"; // present
      if (key === "apikey.openai") return null; // absent
      throw new Error("keychain locked"); // google-ai → error
    });
    const out = await loadApiKeysWithStatus([
      "anthropic",
      "openai",
      "google-ai",
    ]);
    expect(out).toEqual({
      anthropic: { status: "present", value: "sk-a" },
      openai: { status: "absent", value: "" },
      "google-ai": { status: "error", value: "" },
    });
  });
});

describe("migrateLegacyApiKeys", () => {
  it("migrates a plaintext key into an empty keychain slot and verifies", async () => {
    // get(empty) → set → get(verify) sequence.
    mockInvoke
      .mockResolvedValueOnce(null) // pre-check: keychain empty
      .mockResolvedValueOnce(undefined) // set_secret
      .mockResolvedValueOnce("sk-legacy"); // verify read

    const migrated = await migrateLegacyApiKeys({ anthropic: "sk-legacy" });

    expect(migrated).toEqual(["anthropic"]);
    expect(mockInvoke).toHaveBeenCalledWith("set_secret", {
      key: "apikey.anthropic",
      value: "sk-legacy",
    });
  });

  it("never clobbers an existing keychain key (idempotent re-run)", async () => {
    mockInvoke.mockResolvedValueOnce("sk-existing"); // pre-check finds a value
    const migrated = await migrateLegacyApiKeys({ anthropic: "sk-legacy" });
    expect(migrated).toEqual([]);
    // No set_secret call — existing key wins.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "set_secret",
      expect.anything()
    );
  });

  it("skips empty legacy values", async () => {
    const migrated = await migrateLegacyApiKeys({ openai: "" });
    expect(migrated).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not report success and does not lose data when set fails", async () => {
    mockInvoke
      .mockResolvedValueOnce(null) // pre-check empty
      .mockRejectedValueOnce(new Error("keychain denied")); // set fails
    const migrated = await migrateLegacyApiKeys({ anthropic: "sk-legacy" });
    expect(migrated).toEqual([]); // not migrated → caller keeps plaintext
  });

  it("does NOT clobber when the pre-check read throws (keep plaintext, keychain untouched)", async () => {
    // The root-cause bug: a transient read error used to look like "" (unset),
    // bypassing the no-clobber guard and overwriting a live secret with stale
    // plaintext. The strict reader must classify this as ERROR and skip.
    mockInvoke.mockRejectedValueOnce(new Error("keychain locked"));
    const migrated = await migrateLegacyApiKeys({ anthropic: "sk-legacy" });
    expect(migrated).toEqual([]); // not migrated
    // No write attempted — the keychain is left untouched.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "set_secret",
      expect.anything()
    );
  });

  it("migrates when the pre-check read returns null (absent slot)", async () => {
    mockInvoke
      .mockResolvedValueOnce(null) // pre-check: absent
      .mockResolvedValueOnce(undefined) // set_secret
      .mockResolvedValueOnce("sk-legacy"); // verify present
    const migrated = await migrateLegacyApiKeys({ openai: "sk-legacy" });
    expect(migrated).toEqual(["openai"]);
    expect(mockInvoke).toHaveBeenCalledWith("set_secret", {
      key: "apikey.openai",
      value: "sk-legacy",
    });
  });

  it("does not report success when the verify read disagrees", async () => {
    mockInvoke
      .mockResolvedValueOnce(null) // pre-check empty
      .mockResolvedValueOnce(undefined) // set ok
      .mockResolvedValueOnce("different"); // verify mismatch
    const migrated = await migrateLegacyApiKeys({ anthropic: "sk-legacy" });
    expect(migrated).toEqual([]);
  });
});
