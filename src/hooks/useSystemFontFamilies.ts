/**
 * useSystemFontFamilies — React adapter over `services/fonts/systemFonts`.
 *
 * Starts empty and fills in when the backend answers, which is also the
 * permanent state on platforms VMark does not enumerate (#1429). Callers must
 * therefore treat "empty" as normal rather than as "still loading": the font
 * pickers show the curated list plus a typed-family field either way.
 *
 * @coordinates-with services/fonts/systemFonts.ts
 * @module hooks/useSystemFontFamilies
 */
import { useEffect, useState } from "react";
import { loadSystemFontFamilies } from "@/services/fonts/systemFonts";

const NONE: string[] = [];

/** Font families installed on this machine; `[]` until (or unless) they arrive. */
export function useSystemFontFamilies(): string[] {
  const [families, setFamilies] = useState<string[]>(NONE);

  useEffect(() => {
    let alive = true;
    // `loadSystemFontFamilies` never rejects — it degrades to an empty list —
    // so there is no catch to write and no error state to render.
    void loadSystemFontFamilies().then((names) => {
      if (alive) setFamilies(names);
    });
    return () => {
      alive = false;
    };
  }, []);

  return families;
}
