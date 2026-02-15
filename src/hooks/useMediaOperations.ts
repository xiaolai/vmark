/**
 * Media Operations (Hooks Layer)
 *
 * Purpose: Async media file operations — copying video/audio files to the document's
 * assets directory and inserting ProseMirror nodes.
 *
 * Key decisions:
 *   - No resize for media (unlike images — media files are too large to process in-browser)
 *   - Hash-based dedup reused from image hash registry
 *   - Uses relative paths in markdown for portability
 *   - Tauri filesystem APIs for all I/O
 *
 * @coordinates-with useImageOperations.ts — reuses ensureAssetsFolder, hash registry
 * @coordinates-with plugins/mediaHandler/tiptap.ts — drop/paste handler
 * @module hooks/useMediaOperations
 */

import { copyFile, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { EditorView } from "@tiptap/pm/view";
import {
  generateUniqueFilename,
  getFilename,
  buildAssetRelativePath,
} from "@/utils/imageUtils";
import { computeDataHash } from "@/utils/imageHash";
import { findExistingImage, registerImageHash } from "@/utils/imageHashRegistry";
import { ensureAssetsFolder } from "@/hooks/useImageOperations";

/**
 * Copy a media file (video/audio) from a local path to the document's assets folder.
 * Uses hash-based deduplication.
 * Returns the relative path for markdown insertion.
 */
export async function copyMediaToAssets(
  sourcePath: string,
  documentPath: string
): Promise<string> {
  const data = await readFile(sourcePath);
  const hash = await computeDataHash(data);

  const existing = await findExistingImage(documentPath, hash);
  if (existing) return existing;

  const assetsPath = await ensureAssetsFolder(documentPath);
  const originalFilename = getFilename(sourcePath);
  const filename = generateUniqueFilename(originalFilename);
  const destPath = await join(assetsPath, filename);
  await copyFile(sourcePath, destPath);

  const relativePath = buildAssetRelativePath(filename);
  await registerImageHash(documentPath, hash, relativePath);
  return relativePath;
}

/**
 * Save media binary data (from clipboard/drag) to the assets folder.
 * Returns the relative path for markdown insertion.
 */
export async function saveMediaToAssets(
  data: Uint8Array,
  originalFilename: string,
  documentPath: string
): Promise<string> {
  const hash = await computeDataHash(data);

  const existing = await findExistingImage(documentPath, hash);
  if (existing) return existing;

  const assetsPath = await ensureAssetsFolder(documentPath);
  const filename = generateUniqueFilename(originalFilename);
  const destPath = await join(assetsPath, filename);
  await writeFile(destPath, data);

  const relativePath = buildAssetRelativePath(filename);
  await registerImageHash(documentPath, hash, relativePath);
  return relativePath;
}

/**
 * Insert a block_video node at the current cursor position.
 */
export function insertBlockVideoNode(
  view: EditorView,
  src: string,
  title = "",
  poster = ""
): void {
  const { state, dispatch } = view;
  const blockVideoType = state.schema.nodes.block_video;
  if (!blockVideoType) return;

  const node = blockVideoType.create({
    src,
    title,
    poster,
    controls: true,
    preload: "metadata",
  });

  const insertPos = state.selection.to;
  const tr = state.tr.insert(insertPos, node);
  dispatch(tr);
}

/**
 * Insert a block_audio node at the current cursor position.
 */
export function insertBlockAudioNode(
  view: EditorView,
  src: string,
  title = ""
): void {
  const { state, dispatch } = view;
  const blockAudioType = state.schema.nodes.block_audio;
  if (!blockAudioType) return;

  const node = blockAudioType.create({
    src,
    title,
    controls: true,
    preload: "metadata",
  });

  const insertPos = state.selection.to;
  const tr = state.tr.insert(insertPos, node);
  dispatch(tr);
}
