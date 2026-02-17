/**
 * Image Resize Utility
 *
 * Resizes images before saving to assets folder.
 * Uses canvas-based resizing for quality downscaling.
 *
 * @module utils/imageResize
 */

import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Get the effective max dimension from settings.
 * Returns 0 if auto-resize is disabled.
 */
export function getAutoResizeMax(): number {
  const { autoResizeMax } = useSettingsStore.getState().image;

  // 0 means disabled, otherwise use the configured max dimension
  return autoResizeMax;
}

/**
 * Create an image element from a Blob.
 */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Resize an image using canvas.
 * Maintains aspect ratio, scaling down to fit within maxDimension.
 */
async function resizeWithCanvas(
  img: HTMLImageElement,
  maxDimension: number,
  mimeType: string
): Promise<Blob> {
  const { width, height } = img;

  // Calculate new dimensions maintaining aspect ratio
  let newWidth = width;
  let newHeight = height;

  if (width > height) {
    if (width > maxDimension) {
      newHeight = Math.round((height * maxDimension) / width);
      newWidth = maxDimension;
    }
  } else {
    if (height > maxDimension) {
      newWidth = Math.round((width * maxDimension) / height);
      newHeight = maxDimension;
    }
  }

  // Create canvas and draw resized image
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  // Use high quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, newWidth, newHeight);

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      },
      mimeType,
      0.92 // Quality for JPEG
    );
  });
}

/**
 * Detect MIME type from image data.
 */
function detectMimeType(data: Uint8Array): string {
  // Check magic bytes
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return "image/gif";
  }
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    // Could be WebP (RIFF....WEBP)
    if (data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
      return "image/webp";
    }
  }
  // Default to PNG for unknown formats
  return "image/png";
}

export interface ResizeResult {
  data: Uint8Array;
  wasResized: boolean;
  originalWidth?: number;
  originalHeight?: number;
  newWidth?: number;
  newHeight?: number;
}

/**
 * Resize image data if it exceeds the configured max dimension.
 * Returns the original data unchanged if:
 * - Auto-resize is disabled (maxDimension = 0)
 * - Image is already smaller than maxDimension
 * - Image is a GIF (to preserve animation)
 */
export async function resizeImageIfNeeded(imageData: Uint8Array): Promise<ResizeResult> {
  const maxDimension = getAutoResizeMax();

  // Auto-resize disabled
  if (maxDimension === 0) {
    return { data: imageData, wasResized: false };
  }

  const mimeType = detectMimeType(imageData);

  // Skip GIFs to preserve animation
  if (mimeType === "image/gif") {
    return { data: imageData, wasResized: false };
  }

  // Load image to get dimensions
  const blob = new Blob([imageData], { type: mimeType });
  const img = await loadImage(blob);

  const { width, height } = img;

  // Check if resize is needed
  if (width <= maxDimension && height <= maxDimension) {
    return {
      data: imageData,
      wasResized: false,
      originalWidth: width,
      originalHeight: height,
    };
  }

  // Resize the image
  const resizedBlob = await resizeWithCanvas(img, maxDimension, mimeType);
  const resizedData = new Uint8Array(await resizedBlob.arrayBuffer());

  // Calculate new dimensions for logging
  let newWidth = width;
  let newHeight = height;
  if (width > height) {
    newHeight = Math.round((height * maxDimension) / width);
    newWidth = maxDimension;
  } else {
    newWidth = Math.round((width * maxDimension) / height);
    newHeight = maxDimension;
  }

  console.log(
    `[ImageResize] Resized from ${width}×${height} to ${newWidth}×${newHeight}`
  );

  return {
    data: resizedData,
    wasResized: true,
    originalWidth: width,
    originalHeight: height,
    newWidth,
    newHeight,
  };
}
