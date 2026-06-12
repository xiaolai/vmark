/**
 * Image Hash Registry
 *
 * Manages a registry of image content hashes to prevent duplicates.
 * Registry is stored as JSON in assets/images/image-hashes.json
 */

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import { ASSETS_FOLDER } from "@/utils/imageUtils";
import { imageHashWarn, imageHashError } from "@/utils/debug";

const REGISTRY_FILENAME = "image-hashes.json";
const REGISTRY_VERSION = 1;

interface HashRegistry {
  version: number;
  hashes: Record<string, string>; // hash → filename
}

/**
 * Get registry file path for a document.
 */
async function getRegistryPath(documentPath: string): Promise<string> {
  const docDir = await dirname(documentPath);
  const assetsPath = await join(docDir, ASSETS_FOLDER);
  return join(assetsPath, REGISTRY_FILENAME);
}

/**
 * Load hash registry for a document's assets folder.
 * Returns empty registry if file doesn't exist or is invalid.
 */
export async function loadHashRegistry(
  documentPath: string
): Promise<HashRegistry> {
  const registryPath = await getRegistryPath(documentPath);

  try {
    const registryExists = await exists(registryPath);
    if (!registryExists) {
      return { version: REGISTRY_VERSION, hashes: {} };
    }

    const content = await readTextFile(registryPath);
    const data = JSON.parse(content) as HashRegistry;

    // Validate structure
    if (
      typeof data !== "object" ||
      typeof data.version !== "number" ||
      typeof data.hashes !== "object"
    ) {
      imageHashWarn("Invalid registry format, resetting");
      return { version: REGISTRY_VERSION, hashes: {} };
    }

    return data;
  } catch (error) {
    imageHashWarn("Failed to load registry:", error);
    return { version: REGISTRY_VERSION, hashes: {} };
  }
}

/**
 * Save hash registry to disk.
 */
export async function saveHashRegistry(
  documentPath: string,
  registry: HashRegistry
): Promise<void> {
  const registryPath = await getRegistryPath(documentPath);

  try {
    const content = JSON.stringify(registry, null, 2);
    await writeTextFile(registryPath, content);
  } catch (error) {
    imageHashError("Failed to save registry:", error);
  }
}

/**
 * Check if an image with this hash already exists.
 * Returns the existing relative path if found, null otherwise.
 */
export async function findExistingImage(
  documentPath: string,
  hash: string
): Promise<string | null> {
  const registry = await loadHashRegistry(documentPath);
  const filename = registry.hashes[hash];

  if (!filename) {
    return null;
  }

  // Verify the file still exists
  const docDir = await dirname(documentPath);
  const assetsPath = await join(docDir, ASSETS_FOLDER);
  const filePath = await join(assetsPath, filename);

  const fileExists = await exists(filePath);
  if (!fileExists) {
    // File was deleted, remove from registry
    delete registry.hashes[hash];
    await saveHashRegistry(documentPath, registry);
    return null;
  }

  // Return relative path in markdown format
  return `./${ASSETS_FOLDER}/${filename}`;
}

/**
 * Register a new image hash.
 */
export async function registerImageHash(
  documentPath: string,
  hash: string,
  filename: string
): Promise<void> {
  const registry = await loadHashRegistry(documentPath);
  registry.hashes[hash] = filename;
  await saveHashRegistry(documentPath, registry);
}
