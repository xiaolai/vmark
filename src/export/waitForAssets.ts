/**
 * Asset Stability Utilities
 *
 * Ensures all async content (fonts, images, Math, Mermaid) has rendered
 * before proceeding with export or print.
 */

import { checkImages, getStabilityStatus, type StabilityStatus } from "./assetReadiness";

/**
 * The readiness predicates stay importable from HERE. `ExportSurface` and the
 * test suite reach `isImageSettled`/`getStabilityStatus` through this module,
 * and the split is about where the code lives, not about moving every caller.
 */
export { getStabilityStatus, isImageSettled } from "./assetReadiness";

export interface StabilityOptions {
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 100) */
  interval?: number;
  /** Called with progress updates */
  onProgress?: (status: StabilityStatus) => void;
}

/** Result of asset stability polling with final status and any warnings. */
export interface StabilityResult {
  success: boolean;
  status: StabilityStatus;
  warnings: string[];
}

/** The documented defaults, in one place — `StabilityOptions` names them too. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 100;

/** Said once, in `warnings`, so a caller passing nonsense can SEE that it did. */
const UNUSABLE_BOUNDS_WARNING = "Ignored an unusable timeout/interval option; used the defaults";

/**
 * The poll's two bounds, refused rather than trusted.
 *
 * A non-finite or non-positive `timeout` is not a shorter deadline — it is NO
 * deadline: `elapsed >= NaN` is false forever, so the poll this module
 * documents as bounded never ends, which is the export hang #348 fixed from the
 * other side. A non-positive `interval` schedules the next poll with no gap at
 * all and spins the main thread. Neither is a value the caller can have meant,
 * so both fall back to the documented default — and say so in `warnings`,
 * because silently substituting a number is how the next caller never learns
 * (audit round 3, #707).
 */
function usableBounds({ timeout, interval }: StabilityOptions): {
  timeout: number;
  interval: number;
  usable: boolean;
} {
  const positive = (value: number | undefined): boolean =>
    value === undefined || (Number.isFinite(value) && value > 0);
  return {
    timeout: positive(timeout) ? (timeout ?? DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    interval: positive(interval) ? (interval ?? DEFAULT_INTERVAL_MS) : DEFAULT_INTERVAL_MS,
    usable: positive(timeout) && positive(interval),
  };
}

/**
 * Wait for the fonts to load, but never past `timeout`: `document.fonts.ready`
 * is not bounded by anything, and an export that awaited it unraced hung for
 * as long as a stalled font fetch did (audit 20260907). On the deadline the
 * poll below reports `fontsReady: false` and a warning, like any other asset.
 */
async function waitForFonts(timeout: number): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, timeout);
      }),
    ]);
  } catch {
    // Font API not available in some environments
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * A status, as the sentences a caller can act on.
 *
 * Pure and module-level — status-to-warning is a mapping, not part of the
 * deadline race it used to be nested inside (audit round 3, #706). The four
 * closures left in the poll below ARE the state machine: they share exactly
 * two mutable cells and a `resolve` that only exists inside the promise
 * executor, so hoisting them into a class would move that state behind `this.`
 * and give it a lifetime that outlives the promise.
 */
function pendingWarnings(status: StabilityStatus, container: HTMLElement): string[] {
  const warnings: string[] = [];
  if (!status.fontsReady) warnings.push("Fonts did not finish loading");
  if (!status.imagesReady) {
    warnings.push(`${checkImages(container).pending} image(s) did not load`);
  }
  if (!status.mathReady) warnings.push("Some math blocks did not finish rendering");
  if (!status.mermaidReady) warnings.push("Some Mermaid diagrams did not finish rendering");
  return warnings;
}

/**
 * Wait for all assets in a container to be ready for export.
 *
 * This checks:
 * 1. Fonts are loaded
 * 2. All images have loaded or errored
 * 3. Math (KaTeX) has finished rendering
 * 4. Mermaid diagrams have finished rendering
 *
 * @param container - The DOM element containing the content
 * @param options - Configuration options
 * @returns Promise resolving to stability result
 *
 * @example
 * ```ts
 * const result = await waitForAssets(container, {
 *   timeout: 5000,
 *   onProgress: (status) => console.log(status),
 * });
 *
 * if (result.success) {
 *   // All assets ready, proceed with export
 * } else {
 *   // Some assets failed to load
 *   console.warn(result.warnings);
 * }
 * ```
 */
export async function waitForAssets(
  container: HTMLElement,
  options: StabilityOptions = {}
): Promise<StabilityResult> {
  const { onProgress } = options;
  const { timeout, interval, usable } = usableBounds(options);

  const warnings: string[] = [];
  if (!usable) warnings.push(UNUSABLE_BOUNDS_WARNING);
  const startTime = Date.now();

  // Wait for fonts first — bounded by the same deadline as everything else.
  await waitForFonts(timeout);

  // Poll for other assets
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: StabilityResult): void => {
      if (done) return;
      done = true;
      resolve(result);
    };

    // A consumer callback that throws must not leave the export pending
    // (audit #352): the failure is recorded once and the poll goes on.
    let progressFailed = false;
    const report = (status: StabilityStatus): void => {
      try {
        onProgress?.(status);
      } catch (error) {
        if (progressFailed) return;
        progressFailed = true;
        warnings.push(
          `Progress callback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    // What is still pending, recorded the way the caller can act on it. Shared
    // by the poll's own timeout and the layout deadline below, because a
    // deadline that reports nothing is a timeout that looks like a success.
    const reportPending = (status: StabilityStatus): void => {
      warnings.push(...pendingWarnings(status, container));
    };

    // Two frames for layout, then a RE-CHECK (#353): an asset invalidated
    // during layout resumes polling instead of shipping a stale "ready". The
    // frames are bounded by the deadline (#354) — throttled or suspended
    // frames used to hang the export indefinitely once it was ready.
    //
    // The deadline REPORTS WHAT IT FINDS, it does not assume the readiness the
    // poll saw before the frames (#354, round 2). An asset invalidated while
    // the frames never arrived is exactly the case the re-check exists to
    // refuse, and answering `success: true` there shipped it anyway.
    const settle = (elapsed: number): void => {
      const deadline = setTimeout(() => {
        warnings.push("Layout did not settle before the deadline");
        const status = getStabilityStatus(container);
        if (!status.allReady) reportPending(status);
        finish({ success: status.allReady, status, warnings });
      }, Math.max(0, timeout - elapsed));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          clearTimeout(deadline);
          const status = getStabilityStatus(container);
          if (status.allReady) finish({ success: true, status, warnings });
          else check();
        });
      });
    };

    const check = (): void => {
      if (done) return;
      const elapsed = Date.now() - startTime;
      const status = getStabilityStatus(container);

      report(status);

      if (status.allReady) {
        settle(elapsed);
        return;
      }

      if (elapsed >= timeout) {
        reportPending(status);
        finish({ success: false, status, warnings });
        return;
      }

      // Never longer than what is LEFT (#709): this poll is what detects the
      // deadline, so waiting a full interval past it is how a documented 10s
      // maximum became 10s plus one interval. `elapsed < timeout` here, so the
      // remainder is positive.
      setTimeout(check, Math.min(interval, timeout - elapsed));
    };

    check();
  });
}
