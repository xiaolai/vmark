// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeDataHash } from "./imageHash";

describe("imageHash", () => {
  describe("computeDataHash", () => {
    it("returns consistent hash for same data", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = await computeDataHash(data);
      const hash2 = await computeDataHash(data);

      expect(hash1).toBe(hash2);
    });

    it("returns different hashes for different data", async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);

      const hash1 = await computeDataHash(data1);
      const hash2 = await computeDataHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it("handles empty array", async () => {
      const data = new Uint8Array([]);
      const hash = await computeDataHash(data);

      // SHA-256 of empty data is a well-known constant
      // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("returns 64-character hex string (SHA-256)", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await computeDataHash(data);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles large data arrays", async () => {
      const data = new Uint8Array(10000).fill(42);
      const hash = await computeDataHash(data);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces correct hash for known input", async () => {
      // "hello" as bytes
      const hello = new TextEncoder().encode("hello");
      const hash = await computeDataHash(hello);

      // SHA-256 of "hello" is a known value
      expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });

    it("is case-insensitive in output (always lowercase)", async () => {
      const data = new Uint8Array([255, 254, 253]);
      const hash = await computeDataHash(data);

      // All hex characters should be lowercase
      expect(hash).toBe(hash.toLowerCase());
    });
  });
});
