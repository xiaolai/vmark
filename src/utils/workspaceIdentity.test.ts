/**
 * Unit tests for workspace identity logic
 */
import { describe, it, expect } from "vitest";
import {
  createWorkspaceIdentity,
  generateUUID,
  grantTrust,
  revokeTrust,
  isTrusted,
} from "./workspaceIdentity";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("workspaceIdentity", () => {
  describe("generateUUID", () => {
    it("generates valid UUID format", () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(UUID_V4_REGEX);
    });

    it("generates unique UUIDs", () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(100);
    });

    it("uses fallback when crypto.randomUUID is unavailable", () => {
      const originalRandomUUID = crypto.randomUUID;
      // Temporarily remove randomUUID to trigger fallback
      Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });

      const uuid = generateUUID();
      // Fallback generates UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // Restore
      Object.defineProperty(crypto, "randomUUID", { value: originalRandomUUID, configurable: true });
    });

    it("fallback generates unique UUIDs", () => {
      const originalRandomUUID = crypto.randomUUID;
      Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });

      const uuids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(50);

      Object.defineProperty(crypto, "randomUUID", { value: originalRandomUUID, configurable: true });
    });
  });

  describe("createWorkspaceIdentity", () => {
    it("creates identity with valid UUID", () => {
      const identity = createWorkspaceIdentity();
      expect(identity.id).toMatch(UUID_V4_REGEX);
    });

    it("creates identity as untrusted", () => {
      const identity = createWorkspaceIdentity();
      expect(identity.trustLevel).toBe("untrusted");
      expect(identity.trustedAt).toBeNull();
    });

    it("sets creation timestamp", () => {
      const before = Date.now();
      const identity = createWorkspaceIdentity();
      const after = Date.now();
      expect(identity.createdAt).toBeGreaterThanOrEqual(before);
      expect(identity.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe("grantTrust", () => {
    it("updates trust level to trusted", () => {
      const identity = createWorkspaceIdentity();
      const trusted = grantTrust(identity);
      expect(trusted.trustLevel).toBe("trusted");
      expect(trusted.trustedAt).not.toBeNull();
    });

    it("preserves other identity fields", () => {
      const identity = createWorkspaceIdentity();
      const trusted = grantTrust(identity);
      expect(trusted.id).toBe(identity.id);
      expect(trusted.createdAt).toBe(identity.createdAt);
    });
  });

  describe("revokeTrust", () => {
    it("updates trust level to untrusted", () => {
      const identity = grantTrust(createWorkspaceIdentity());
      const untrusted = revokeTrust(identity);
      expect(untrusted.trustLevel).toBe("untrusted");
      expect(untrusted.trustedAt).toBeNull();
    });
  });

  describe("isTrusted", () => {
    it("returns false for untrusted identity", () => {
      const identity = createWorkspaceIdentity();
      expect(isTrusted(identity)).toBe(false);
    });

    it("returns true for trusted identity", () => {
      const identity = grantTrust(createWorkspaceIdentity());
      expect(isTrusted(identity)).toBe(true);
    });

    it("returns false for undefined", () => {
      expect(isTrusted(undefined)).toBe(false);
    });
  });
});
