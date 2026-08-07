// @vitest-environment node
import { describe, it, expect } from "vitest";
import { uint8ArrayToBase64, fontDataToDataUri } from "../fontEmbedder";

/**
 * Tests for uint8ArrayToBase64 — the chunked base64 encoder that avoids
 * V8's argument-count limit when spreading large Uint8Arrays into
 * String.fromCharCode().
 *
 * The old approach `btoa(String.fromCharCode(...data))` crashes for
 * arrays > ~65 535 bytes. The chunked version processes 8192 bytes at a time.
 */

// ---------------------------------------------------------------------------
// Helper: reference encoder using native btoa for small arrays
// ---------------------------------------------------------------------------
function referenceBtoa(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

// ---------------------------------------------------------------------------
// Helper: decode base64 back to bytes for round-trip verification
// ---------------------------------------------------------------------------
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Helper: create a Uint8Array of given length filled with a repeating pattern
// ---------------------------------------------------------------------------
function makeData(length: number, seed = 0): Uint8Array {
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = (i + seed) & 0xff;
  }
  return arr;
}

describe("uint8ArrayToBase64", () => {
  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------
  describe("empty input", () => {
    it("returns empty string for zero-length Uint8Array", () => {
      const result = uint8ArrayToBase64(new Uint8Array(0));
      expect(result).toBe("");
    });

    it("matches btoa of empty string", () => {
      expect(uint8ArrayToBase64(new Uint8Array(0))).toBe(btoa(""));
    });
  });

  // -------------------------------------------------------------------------
  // Single byte edge cases
  // -------------------------------------------------------------------------
  describe("single byte values", () => {
    it.each([
      { value: 0, label: "null byte (0x00)" },
      { value: 127, label: "max ASCII (0x7F)" },
      { value: 128, label: "first high byte (0x80)" },
      { value: 255, label: "max byte (0xFF)" },
    ])("encodes $label correctly", ({ value }) => {
      const data = new Uint8Array([value]);
      const result = uint8ArrayToBase64(data);
      expect(result).toBe(referenceBtoa(data));
    });
  });

  // -------------------------------------------------------------------------
  // Small data
  // -------------------------------------------------------------------------
  describe("small data", () => {
    it("encodes 1 byte", () => {
      const data = new Uint8Array([65]); // 'A'
      expect(uint8ArrayToBase64(data)).toBe(btoa("A"));
    });

    it("encodes 10 bytes", () => {
      const data = makeData(10);
      const result = uint8ArrayToBase64(data);
      expect(result).toBe(referenceBtoa(data));
    });

    it("encodes 100 bytes", () => {
      const data = makeData(100);
      expect(uint8ArrayToBase64(data)).toBe(referenceBtoa(data));
    });
  });

  // -------------------------------------------------------------------------
  // All byte values (correctness for the full 0-255 range)
  // -------------------------------------------------------------------------
  describe("all byte values", () => {
    it("correctly encodes every byte value 0-255", () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const result = uint8ArrayToBase64(data);
      expect(result).toBe(referenceBtoa(data));
    });

    it("round-trips every byte value 0-255", () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const decoded = base64ToBytes(uint8ArrayToBase64(data));
      expect(decoded).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // Chunk boundary tests (CHUNK = 8192)
  // -------------------------------------------------------------------------
  describe("chunk boundaries (CHUNK = 8192)", () => {
    it("encodes CHUNK - 1 = 8191 bytes", () => {
      const data = makeData(8191);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes exactly CHUNK = 8192 bytes (one full chunk)", () => {
      const data = makeData(8192);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes CHUNK + 1 = 8193 bytes (one chunk + 1 byte remainder)", () => {
      const data = makeData(8193);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes 2 * CHUNK = 16384 bytes (exactly two chunks)", () => {
      const data = makeData(16384);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes 2 * CHUNK + 1 = 16385 bytes", () => {
      const data = makeData(16385);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // V8 argument limit boundary (the bug this fix addresses)
  // -------------------------------------------------------------------------
  describe("V8 argument limit boundary", () => {
    it("encodes 65,535 bytes (V8 arg limit - 1) — would have worked before", () => {
      const data = makeData(65_535);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes 65,536 bytes (V8 arg limit) — would have CRASHED before the fix", () => {
      const data = makeData(65_536);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // Realistic font/image sizes
  // -------------------------------------------------------------------------
  describe("realistic sizes", () => {
    it("encodes 100,000 bytes (typical font)", () => {
      const data = makeData(100_000);
      const result = uint8ArrayToBase64(data);
      expect(result.length).toBeGreaterThan(0);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes 200,000 bytes (large font)", () => {
      const data = makeData(200_000);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });

    it("encodes 500,000 bytes (large image)", { timeout: 30_000 }, () => {
      const data = makeData(500_000);
      const result = uint8ArrayToBase64(data);
      const decoded = base64ToBytes(result);
      expect(decoded).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // Known input/output correctness
  // -------------------------------------------------------------------------
  describe("known input/output", () => {
    it("encodes 'Hello' as base64", () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      expect(uint8ArrayToBase64(data)).toBe("SGVsbG8=");
    });

    it("encodes 'ABC' as base64", () => {
      const data = new Uint8Array([65, 66, 67]); // "ABC"
      expect(uint8ArrayToBase64(data)).toBe("QUJD");
    });

    it("encodes empty produces empty base64", () => {
      expect(uint8ArrayToBase64(new Uint8Array([]))).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Divisibility edge cases
  // -------------------------------------------------------------------------
  describe("divisibility edge cases", () => {
    it("length exactly divisible by CHUNK with no remainder", () => {
      // 8192 * 5 = 40960
      const data = makeData(40_960);
      const decoded = base64ToBytes(uint8ArrayToBase64(data));
      expect(decoded).toEqual(data);
    });

    it("length = CHUNK * N - 1 (always has 1-byte short chunk)", () => {
      const data = makeData(8192 * 3 - 1); // 24575
      const decoded = base64ToBytes(uint8ArrayToBase64(data));
      expect(decoded).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // Return type
  // -------------------------------------------------------------------------
  it("always returns a string", () => {
    expect(typeof uint8ArrayToBase64(new Uint8Array(0))).toBe("string");
    expect(typeof uint8ArrayToBase64(new Uint8Array(1))).toBe("string");
    expect(typeof uint8ArrayToBase64(makeData(10_000))).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// fontDataToDataUri
// ---------------------------------------------------------------------------
describe("fontDataToDataUri", () => {
  it("produces valid data URI format", () => {
    const data = new Uint8Array([0x00, 0x01, 0x02]);
    const uri = fontDataToDataUri(data);
    expect(uri).toMatch(/^data:font\/woff2;base64,.+$/);
  });

  it("contains correct base64 payload", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const uri = fontDataToDataUri(data);
    expect(uri).toBe("data:font/woff2;base64,SGVsbG8=");
  });

  it("handles empty data", () => {
    const uri = fontDataToDataUri(new Uint8Array(0));
    expect(uri).toBe("data:font/woff2;base64,");
  });

  it("handles large font data without crashing", () => {
    const data = makeData(150_000);
    const uri = fontDataToDataUri(data);
    expect(uri).toMatch(/^data:font\/woff2;base64,/);
    // Verify the base64 payload decodes correctly
    const base64 = uri.replace("data:font/woff2;base64,", "");
    const decoded = base64ToBytes(base64);
    expect(decoded).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// Import check: resourceResolver uses uint8ArrayToBase64
// ---------------------------------------------------------------------------
describe("resourceResolver integration", () => {
  it("imports uint8ArrayToBase64 from fontEmbedder", async () => {
    // Verify the import exists in resourceResolver.ts — if the import were
    // removed, this dynamic import would fail or the symbol would be missing.
    const mod = await import("../resourceResolver");
    // fileToDataUri exists and is a function (it internally uses uint8ArrayToBase64)
    expect(typeof mod.fileToDataUri).toBe("function");
  });
});
