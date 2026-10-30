/**
 * GHA workflow export wiring — connects the pure export functions to UI actions.
 *
 * Side-effecting helpers that turn the pure export functions
 * (toMermaid / exportCanvas) into real user actions:
 *   - copyMermaid: write a Mermaid flowchart string to the clipboard.
 *   - saveImage:   render the live canvas to SVG/PNG and write it to a
 *                  user-chosen path via the Tauri save dialog.
 *
 * Kept separate from the React control so the I/O glue is unit-testable
 * without mounting xyflow. Mirrors the save flow in
 * src/plugins/mermaid/mermaidExport.ts (Tauri save dialog → writeFile).
 *
 * @module lib/ghaWorkflow/export/saveExport
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportCanvas, type ExportFormat } from "./toImage";

/**
 * Copy a Mermaid flowchart string to the system clipboard.
 * Returns true on success, false if the clipboard write rejected.
 */
export async function copyMermaid(mermaid: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(mermaid);
    return true;
  } catch {
    return false;
  }
}

/** Decode a `data:` URI's payload into raw bytes for writing to disk. */
function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(",");
  if (comma === -1) throw new Error("saveImage: malformed data URI");
  const meta = dataUri.slice(0, comma);
  const payload = dataUri.slice(comma + 1);
  if (meta.includes(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Non-base64 (e.g. URL-encoded SVG) — decode percent-escapes to UTF-8.
  return new TextEncoder().encode(decodeURIComponent(payload));
}

/**
 * Render the live workflow canvas to the given format and save it to a
 * user-chosen path. Returns "saved" or "cancelled" (no path chosen);
 * throws on a render/write failure so the caller can surface a message.
 *
 * `scope` is the canvas wrapper to capture from (default: the document); a
 * scope with no canvas viewport throws rather than capturing another canvas.
 */
export async function saveImage(
  format: ExportFormat,
  scope?: ParentNode,
): Promise<"saved" | "cancelled"> {
  const dataUri = await exportCanvas(format, scope ? { scope } : {});

  const ext = format === "png" ? "png" : "svg";
  const filterName = format === "png" ? "PNG Image" : "SVG Image";
  const filePath = await save({
    defaultPath: `workflow.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (!filePath) return "cancelled";

  await writeFile(filePath, dataUriToBytes(dataUri));
  return "saved";
}
