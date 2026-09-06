/**
 * The normalized bytes a save is about to write, plus the conventions it chose.
 *
 * Its own module because BOTH `saveToPath` (which produces it) and
 * `applyPostSaveState` (which records it) need the type, and having either
 * import it from the other makes them circular.
 *
 * @module services/persistence/normalizedSaveContent
 */
import type { resolveHardBreakStyle, resolveLineEndingOnSave } from "@/utils/linebreaks";

export interface NormalizedSaveContent {
  output: string;
  targetLineEnding: ReturnType<typeof resolveLineEndingOnSave>;
  targetHardBreakStyle: ReturnType<typeof resolveHardBreakStyle>;
}
