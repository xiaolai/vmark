/**
 * RetryableLazy
 *
 * Purpose: mount a `React.lazy` chunk so that a FAILED load is recoverable in
 *   place — a local error surface with a retry that actually retries.
 *
 * Why this exists (audit 20260804-F3/F4): `React.lazy` memoizes the REJECTED
 * promise for the lifetime of the lazy object. A module-level
 * `const X = lazy(() => import(...))` therefore turns one transient chunk
 * failure into a permanent one: every remount replays the cached rejection,
 * and any boundary above it can only offer a retry that fails identically.
 * Worse, with no local boundary the rejection escapes to whichever ancestor
 * happens to be there — for the KB graph that was the ROOT boundary, so a
 * missing chunk took the whole window down.
 *
 * Key decisions:
 *   - A FRESH `lazy(load)` per ATTEMPT. This is the whole point; without it
 *     "retry" is a button that re-renders a cached rejection. Same discipline
 *     as `components/Editor/FormatSurface.tsx`, which creates one per MOUNT
 *     (its retry is "open the tab again"); here the retry is a click, so the
 *     attempt — not the mount — is the unit.
 *   - The catching is delegated to `FeatureErrorBoundary`, which already logs
 *     the error and exposes a `reset`. Retry = new lazy THEN reset, in one
 *     click handler, so the boundary re-renders against a fresh attempt.
 *   - `load` is read at attempt time but the initial lazy is created once, so
 *     call sites pass a stable module-level thunk; an inline arrow would
 *     still work, it simply would not be re-read until a retry.
 *   - No i18n of its own. The failure text belongs to the feature (the graph
 *     says "Couldn't load the graph", the workflow surface says "Failed to
 *     load"), so the caller renders it.
 *
 * @coordinates-with components/FeatureErrorBoundary.tsx — the catching + reset
 * @coordinates-with components/Editor/FormatSurface.tsx — the per-mount variant
 * @module components/RetryableLazy
 */
import {
  Suspense,
  lazy,
  useCallback,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

export interface RetryableLazyProps<P extends object> {
  /** Label used in the boundary's log line. */
  feature: string;
  /** Import thunk. Re-invoked on every retry — never memoized module-side. */
  load: () => Promise<{ default: ComponentType<P> }>;
  /** Props forwarded to the loaded component. */
  componentProps: P;
  /** Rendered while the chunk is in flight. Defaults to nothing. */
  pending?: ReactNode;
  /** Rendered on failure. Calling `retry` mounts a FRESH lazy. */
  renderError: (retry: () => void, error: Error) => ReactNode;
}

export function RetryableLazy<P extends object>({
  feature,
  load,
  componentProps,
  pending = null,
  renderError,
}: RetryableLazyProps<P>) {
  const [Loaded, setLoaded] = useState<LazyExoticComponent<ComponentType<P>>>(
    () => lazy(load),
  );

  const retry = useCallback(
    (reset: () => void) => {
      // New lazy first, boundary reset second: both land in one React batch,
      // so the children re-render against an attempt that has not failed yet.
      setLoaded(() => lazy(load));
      reset();
    },
    [load],
  );

  return (
    <FeatureErrorBoundary
      feature={feature}
      fallback={(error, reset) => renderError(() => retry(reset), error)}
    >
      <Suspense fallback={pending}>
        <Loaded {...componentProps} />
      </Suspense>
    </FeatureErrorBoundary>
  );
}
