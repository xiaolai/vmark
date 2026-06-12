/**
 * Clipboard Image Path Helper
 *
 * Provides async clipboard reading with image path detection.
 * Validates local paths with filesystem existence check.
 */

import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { detectImagePath, type ImagePathResult } from "@/utils/imagePathDetection";

/**
 * Extended result with validation status.
 */
export interface ClipboardImagePathResult extends ImagePathResult {
  /** Whether the path was validated (for local paths) */
  validated: boolean;
  /** Resolved absolute path (for home paths) */
  resolvedPath: string | null;
}

/**
 * Expand home path (~/) to absolute path.
 */
async function expandHomePath(path: string): Promise<string | null> {
  /* v8 ignore start -- non-home paths are handled by callers before reaching this; false branch is defensive */
  if (!path.startsWith("~/")) return path;
  /* v8 ignore stop */

  try {
    const home = await homeDir();
    return await join(home, path.slice(2));
  } catch {
    return null;
  }
}

/**
 * Validate that a local file path exists.
 */
async function validateLocalPath(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/**
 * Read clipboard and detect image path.
 * For local paths, validates existence with filesystem check.
 *
 * @returns Detection result with validation, or null if clipboard is empty/inaccessible
 *
 * @example
 * const result = await readClipboardImagePath();
 * if (result?.isImage) {
 *   if (result.needsCopy) {
 *     // Copy to assets folder first
 *     const relativePath = await copyImageToAssets(result.resolvedPath ?? result.path, docPath);
 *     insertImage(relativePath);
 *   } else {
 *     // Insert directly (URL or already relative)
 *     insertImage(result.path);
 *   }
 * }
 */
export async function readClipboardImagePath(): Promise<ClipboardImagePathResult | null> {
  try {
    // Try Tauri clipboard first
    let text: string | null = null;
    try {
      text = await readText();
    } catch {
      /* v8 ignore next -- @preserve Tauri clipboard throws only on IPC failure; not reproducible in unit tests */
    }

    // Fallback to web clipboard API if Tauri returns empty or failed
    if (!text && typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        // Web clipboard may fail due to permissions
        return null;
      }
    }

    if (!text) {
      return null;
    }

    // Detect image path
    const detection = detectImagePath(text);

    if (!detection.isImage) {
      return {
        ...detection,
        validated: false,
        resolvedPath: null,
      };
    }

    // For URLs and data URLs, no validation needed
    if (detection.type === "url" || detection.type === "dataUrl") {
      return {
        ...detection,
        validated: true,
        resolvedPath: null,
      };
    }

    // For home paths, expand and validate
    if (detection.type === "homePath") {
      const expanded = await expandHomePath(detection.path);
      if (!expanded) {
        return {
          ...detection,
          validated: false,
          resolvedPath: null,
        };
      }

      const fileExists = await validateLocalPath(expanded);
      return {
        ...detection,
        validated: fileExists,
        resolvedPath: fileExists ? expanded : null,
      };
    }

    // For absolute paths, validate directly
    if (detection.type === "absolutePath") {
      const fileExists = await validateLocalPath(detection.path);
      return {
        ...detection,
        validated: fileExists,
        resolvedPath: fileExists ? detection.path : null,
      };
    }

    // For relative paths, we can't validate without document path
    // Validation will happen at insert time
    /* v8 ignore start -- relative path validation not exercised in tests */
    if (detection.type === "relativePath") {
      return {
        ...detection,
        validated: true, // Assume valid, will fail gracefully at render
        resolvedPath: null,
      };
    }
    /* v8 ignore stop */

    /* v8 ignore start -- @preserve only reachable for unknown detection types; callers always pass absolutePath/relativePath/url/none */
    return {
      ...detection,
      validated: false,
      resolvedPath: null,
    };
    /* v8 ignore stop */
  } catch {
    /* v8 ignore next -- @preserve outer catch guards against unexpected runtime errors in detection/validation pipeline; not reproducible in unit tests */
    return null;
  }
}
