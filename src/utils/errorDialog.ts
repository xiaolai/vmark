/**
 * User-facing error dialog utility
 *
 * Provides consistent error messaging for file operations.
 */

import { message } from "@tauri-apps/plugin-dialog";

/**
 * Show an error dialog to the user.
 * Use for file operation failures that the user needs to know about.
 */
export async function showError(
  title: string,
  description?: string
): Promise<void> {
  const text = description ? `${title}\n\n${description}` : title;
  await message(text, {
    title: "Error",
    kind: "error",
  });
}

/**
 * Common error messages for file operations
 */
export const FileErrors = {
  fileExists: (name: string) => `A file named "${name}" already exists.`,
  folderExists: (name: string) => `A folder named "${name}" already exists.`,
  createFailed: (name: string) => `Failed to create "${name}".`,
  renameFailed: (name: string) => `Failed to rename "${name}".`,
  deleteFailed: (name: string) => `Failed to delete "${name}".`,
  moveFailed: (name: string) => `Failed to move "${name}".`,
  duplicateFailed: (name: string) => `Failed to duplicate "${name}".`,
  copyFailed: "Failed to copy to clipboard.",
  exportFailed: (format: string) => `Failed to export to ${format}.`,
  tooManyCopies: (name: string) => `Too many copies of "${name}" exist. Please delete some first.`,
};
