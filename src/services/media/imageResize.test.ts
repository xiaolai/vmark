import { vi, describe, it, expect, beforeEach } from "vitest";

// --- Mocks (before imports) ---

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/utils/debug", () => ({
  imageResizeLog: vi.fn(),
}));

// --- Imports (after mocks) ---

import { useSettingsStore } from "@/stores/settingsStore";
import { imageResizeLog } from "@/utils/debug";
import { resizeImageIfNeeded } from "./imageResize";

// --- DOM mock helpers ---

/** Build a mock Image that triggers onload with the given natural dimensions. */
function createMockImageClass(width: number, height: number) {
  return class MockImage {
    width = 0;
    height = 0;
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      // Schedule onload on next microtask so callers can attach handlers first
      Promise.resolve().then(() => {
        this.width = width;
        this.height = height;
        this.onload?.();
      });
    }
  };
}

/** Minimal mock canvas context that records drawImage calls. */
function createMockCanvasCtx() {
  return {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "" as ImageSmoothingQuality,
    drawImage: vi.fn(),
  };
}

/** Mock toBlob — calls callback with a Blob that supports arrayBuffer(). */
function mockToBlob(callback: BlobCallback, _mimeType?: string, _quality?: number) {
  const data = new Uint8Array([1, 2, 3]);
  const blob = new Blob([data], { type: _mimeType });
  // jsdom Blob may lack arrayBuffer(); polyfill if needed
  if (!blob.arrayBuffer) {
    (blob as Blob & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = () =>
      Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  callback(blob);
}

// --- Magic byte helpers ---

function pngBytes(): Uint8Array {
  const arr = new Uint8Array(16);
  arr[0] = 0x89;
  arr[1] = 0x50;
  arr[2] = 0x4e;
  arr[3] = 0x47;
  return arr;
}

function jpegBytes(): Uint8Array {
  const arr = new Uint8Array(16);
  arr[0] = 0xff;
  arr[1] = 0xd8;
  arr[2] = 0xff;
  return arr;
}

function gifBytes(): Uint8Array {
  const arr = new Uint8Array(16);
  arr[0] = 0x47;
  arr[1] = 0x49;
  arr[2] = 0x46;
  return arr;
}

function webpBytes(): Uint8Array {
  const arr = new Uint8Array(16);
  // RIFF
  arr[0] = 0x52;
  arr[1] = 0x49;
  arr[2] = 0x46;
  arr[3] = 0x46;
  // ...4 bytes size...
  // WEBP
  arr[8] = 0x57;
  arr[9] = 0x45;
  arr[10] = 0x42;
  arr[11] = 0x50;
  return arr;
}

function unknownBytes(): Uint8Array {
  return new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

// --- Setup ---

const mockedGetState = useSettingsStore.getState as ReturnType<typeof vi.fn>;

function setAutoResizeMax(value: number) {
  mockedGetState.mockReturnValue({ image: { autoResizeMax: value } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: disabled
  setAutoResizeMax(0);
});

describe("resizeImageIfNeeded", () => {
  // ---- Early-return paths (no DOM needed) ----

  it("returns original data when auto-resize disabled (maxDimension=0)", async () => {
    setAutoResizeMax(0);
    const data = pngBytes();
    const result = await resizeImageIfNeeded(data);
    expect(result.wasResized).toBe(false);
    expect(result.data).toBe(data);
  });

  it("returns original data for GIF images (preserve animation)", async () => {
    setAutoResizeMax(800);
    const data = gifBytes();
    const result = await resizeImageIfNeeded(data);
    expect(result.wasResized).toBe(false);
    expect(result.data).toBe(data);
  });

  // ---- Paths that require DOM mocking ----

  /** Install DOM mocks for Image, canvas, and URL. Returns cleanup fn. */
  function installDomMocks(imgWidth: number, imgHeight: number) {
    const MockImage = createMockImageClass(imgWidth, imgHeight);
    const mockCtx = createMockCanvasCtx();

    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => mockCtx),
          toBlob: vi.fn(mockToBlob),
        } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tag);
    });

    return { mockCtx };
  }

  it("returns original data when image is smaller than maxDimension", async () => {
    setAutoResizeMax(2000);
    installDomMocks(800, 600);

    const data = pngBytes();
    const result = await resizeImageIfNeeded(data);

    expect(result.wasResized).toBe(false);
    expect(result.data).toBe(data);
    expect(result.originalWidth).toBe(800);
    expect(result.originalHeight).toBe(600);
  });

  it("returns original data when image equals maxDimension exactly", async () => {
    setAutoResizeMax(800);
    installDomMocks(800, 600);

    const result = await resizeImageIfNeeded(pngBytes());

    expect(result.wasResized).toBe(false);
    expect(result.originalWidth).toBe(800);
    expect(result.originalHeight).toBe(600);
  });

  it("resizes landscape image (width > height > maxDimension)", async () => {
    setAutoResizeMax(1000);
    const { mockCtx } = installDomMocks(2000, 1500);

    const result = await resizeImageIfNeeded(pngBytes());

    expect(result.wasResized).toBe(true);
    expect(result.originalWidth).toBe(2000);
    expect(result.originalHeight).toBe(1500);
    expect(result.newWidth).toBe(1000);
    expect(result.newHeight).toBe(750); // 1500 * 1000 / 2000
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockCtx.imageSmoothingEnabled).toBe(true);
    expect(mockCtx.imageSmoothingQuality).toBe("high");
  });

  it("resizes portrait image (height > width > maxDimension)", async () => {
    setAutoResizeMax(1000);
    installDomMocks(1500, 2000);

    const result = await resizeImageIfNeeded(pngBytes());

    expect(result.wasResized).toBe(true);
    expect(result.originalWidth).toBe(1500);
    expect(result.originalHeight).toBe(2000);
    expect(result.newWidth).toBe(750); // 1500 * 1000 / 2000
    expect(result.newHeight).toBe(1000);
  });

  it("resizes square image exceeding maxDimension", async () => {
    setAutoResizeMax(500);
    installDomMocks(1000, 1000);

    const result = await resizeImageIfNeeded(pngBytes());

    expect(result.wasResized).toBe(true);
    // Square: height === width, so the else branch runs (height > maxDimension)
    expect(result.newWidth).toBe(500); // 1000 * 500 / 1000
    expect(result.newHeight).toBe(500);
  });

  it("maintains aspect ratio for non-trivial dimensions", async () => {
    setAutoResizeMax(600);
    installDomMocks(1920, 1080);

    const result = await resizeImageIfNeeded(pngBytes());

    expect(result.wasResized).toBe(true);
    // Landscape: width dominant → newWidth=600, newHeight=round(1080*600/1920)=338
    expect(result.newWidth).toBe(600);
    expect(result.newHeight).toBe(Math.round((1080 * 600) / 1920));
  });

  it("logs resize dimensions", async () => {
    setAutoResizeMax(500);
    installDomMocks(2000, 1000);

    await resizeImageIfNeeded(pngBytes());

    expect(imageResizeLog).toHaveBeenCalledWith(
      "Resized from 2000×1000 to 500×250"
    );
  });

  // ---- MIME type detection (tested indirectly via resizeImageIfNeeded) ----

  it("handles PNG magic bytes detection", async () => {
    setAutoResizeMax(100);
    installDomMocks(200, 200);

    const result = await resizeImageIfNeeded(pngBytes());
    // If PNG detected correctly, resize proceeds (not skipped like GIF)
    expect(result.wasResized).toBe(true);
  });

  it("handles JPEG magic bytes detection", async () => {
    setAutoResizeMax(100);
    installDomMocks(200, 200);

    const result = await resizeImageIfNeeded(jpegBytes());
    expect(result.wasResized).toBe(true);
  });

  it("handles GIF magic bytes — skips resize", async () => {
    setAutoResizeMax(100);
    // No DOM mocks needed — GIF returns early
    const result = await resizeImageIfNeeded(gifBytes());
    expect(result.wasResized).toBe(false);
  });

  it("handles WebP magic bytes detection", async () => {
    setAutoResizeMax(100);
    installDomMocks(200, 200);

    const result = await resizeImageIfNeeded(webpBytes());
    expect(result.wasResized).toBe(true);
  });

  it("defaults to image/png for unknown formats", async () => {
    setAutoResizeMax(100);
    installDomMocks(200, 200);

    const result = await resizeImageIfNeeded(unknownBytes());
    expect(result.wasResized).toBe(true);
  });

  it("handles RIFF header that is not WebP", async () => {
    setAutoResizeMax(100);
    installDomMocks(200, 200);

    // RIFF header but bytes 8-11 are NOT "WEBP"
    const data = new Uint8Array(16);
    data[0] = 0x52; // R
    data[1] = 0x49; // I
    data[2] = 0x46; // F
    data[3] = 0x46; // F
    data[8] = 0x41; // A (not W)
    data[9] = 0x56; // V (not E)
    data[10] = 0x49; // I (not B)
    data[11] = 0x20; //   (not P)

    const result = await resizeImageIfNeeded(data);
    // Falls through to default image/png — should still resize
    expect(result.wasResized).toBe(true);
  });

  // ---- Error paths ----

  it("rejects when image fails to load", async () => {
    setAutoResizeMax(1000);

    // Image that triggers onerror instead of onload
    const ErrorImage = class {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        Promise.resolve().then(() => {
          this.onerror?.();
        });
      }
    };

    vi.stubGlobal("Image", ErrorImage);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });

    await expect(resizeImageIfNeeded(pngBytes())).rejects.toThrow(
      "Failed to load image"
    );
  });

  it("rejects when canvas context is null", async () => {
    setAutoResizeMax(500);
    installDomMocks(2000, 1000);

    // Override createElement to return canvas with null context
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => null),
          toBlob: vi.fn(),
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    await expect(resizeImageIfNeeded(pngBytes())).rejects.toThrow(
      "Failed to get canvas context"
    );
  });

  it("rejects when toBlob returns null", async () => {
    setAutoResizeMax(500);

    const MockImage = createMockImageClass(2000, 1000);
    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });

    const mockCtx = createMockCanvasCtx();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => mockCtx),
          toBlob: vi.fn((cb: BlobCallback) => cb(null)),
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    await expect(resizeImageIfNeeded(pngBytes())).rejects.toThrow(
      "Failed to create blob from canvas"
    );
  });
});
