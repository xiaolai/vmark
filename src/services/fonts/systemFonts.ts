/**
 * systemFonts — the font families installed on this machine (#1429).
 *
 * Purpose: turn the custom-font setting from "type the exact family name" into
 * "pick one of the ones you have". Font pickers are the only consumer.
 *
 * Key decisions:
 *   - **An empty list is a normal answer, never an error.** Only macOS
 *     enumerates (see `src-tauri/src/system_fonts.rs` for why); everywhere
 *     else the picker falls back to a typed family, which works on every
 *     platform. A failed invoke degrades the same way — suggestions are a
 *     convenience, and rejecting would break a settings panel over a nicety.
 *   - **Cached for the session, but only on success.** The set changes when
 *     the user installs a font, which is rare enough that one query per app
 *     run is right; caching a FAILURE would make one bad call permanent.
 *   - **Every name is re-sanitized here.** The list feeds the same CSS family
 *     reference a typed name does, so it goes through the one validator rather
 *     than being trusted for having come from the backend.
 *
 * @coordinates-with src-tauri/src/system_fonts.rs — the command
 * @coordinates-with utils/fontStacks.ts — `sanitizeCustomFontFamily`, the shared validator
 * @module services/fonts/systemFonts
 */
import { invoke } from "@tauri-apps/api/core";
import { sanitizeCustomFontFamily } from "@/utils/customFont";
import { commandErrorMessage } from "@/services/commands/commandError";
import { fontsWarn } from "@/utils/debug";

let cached: Promise<string[]> | null = null;

/** Keep only the entries that are usable as a CSS family reference. */
function usableFamilies(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const names: string[] = [];
  for (const entry of payload) {
    if (typeof entry !== "string") continue;
    const family = sanitizeCustomFontFamily(entry);
    if (family) names.push(family);
  }
  return names;
}

/** Installed font families, sorted; empty where this platform does not enumerate. */
export function loadSystemFontFamilies(): Promise<string[]> {
  cached ??= invoke("list_system_font_families")
    .then(usableFamilies)
    .catch((error: unknown) => {
      fontsWarn("Failed to list system fonts:", commandErrorMessage(error));
      // Do not cache a failure: one bad call would otherwise be permanent.
      cached = null;
      return [];
    });
  return cached;
}

/** Test seam — drops the session cache. */
export function __resetSystemFontCache(): void {
  cached = null;
}
