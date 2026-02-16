/**
 * IME Composition Hook
 *
 * Purpose: Ref-based composition tracking for React input surfaces.
 * Provides two levels of protection:
 *   1. `composingRef` — true during active composition (gates onChange side effects)
 *   2. `isComposing()` — true during composition OR within a 50ms grace period
 *      after compositionend (gates keyDown handlers against macOS WebKit's
 *      post-composition keydown events)
 *
 * Key decisions:
 *   - 50ms grace period matches the existing ProseMirror guard in imeGuard.ts
 *   - Uses performance.now() for sub-millisecond precision
 *   - Ref-based: no re-renders, safe in callbacks
 *
 * @coordinates-with utils/imeGuard.ts — isImeKeyEvent guards keyDown; this hook adds grace period
 * @module hooks/useImeComposition
 */

import { useCallback, useMemo, useRef } from "react";
import { IME_GRACE_PERIOD_MS } from "@/utils/imeGuard";

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export interface ImeCompositionResult {
  /** True only while actively composing (between compositionstart and compositionend). */
  composingRef: React.RefObject<boolean>;
  /** Handler for the input's onCompositionStart event. */
  onCompositionStart: () => void;
  /** Handler for the input's onCompositionEnd event. */
  onCompositionEnd: () => void;
  /**
   * Returns true if currently composing OR within the grace period after
   * compositionend. Use this in keyDown handlers to catch post-composition
   * keydown events that macOS WebKit fires with isComposing: false.
   */
  isComposing: () => boolean;
}

export function useImeComposition(): ImeCompositionResult {
  const composingRef = useRef(false);
  const compositionEndTimeRef = useRef<number | null>(null);

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    compositionEndTimeRef.current = nowMs();
  }, []);

  const isComposing = useCallback(() => {
    if (composingRef.current) return true;
    if (compositionEndTimeRef.current === null) return false;
    const elapsed = nowMs() - compositionEndTimeRef.current;
    return elapsed < IME_GRACE_PERIOD_MS;
  }, []);

  return useMemo(
    () => ({ composingRef, onCompositionStart, onCompositionEnd, isComposing }),
    [composingRef, onCompositionStart, onCompositionEnd, isComposing],
  );
}
