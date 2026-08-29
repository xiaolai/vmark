/**
 * FormatSurface
 *
 * Purpose: mount a format's WYSIWYG surface, which since WI-13 arrives as an
 *   import thunk rather than a component reference. Owns the async boundary
 *   (Suspense) and the failure boundary that decision-ledger entry **D4**
 *   requires: a rejected thunk must produce a defined, observable error
 *   surface — never a silent blank editor.
 *
 * Key decisions:
 *   - A FRESH `React.lazy` per mount. `React.lazy` memoizes the REJECTED
 *     promise for the lifetime of the lazy object, so reusing one per format
 *     id would make a single transient failure permanent — sticky semantics
 *     by accident, which D4 explicitly rejects. Re-creating it per mount is
 *     what makes "the next mount retries" true, and it costs nothing on the
 *     success path because `resolveFormatSurface` caches the resolved module.
 *   - Suspense fallback is `null`. The surrounding editor chrome is already
 *     painted, and a spinner that appears for one frame reads as a flicker.
 *   - The error state (WI-UI4.4) names the format via `preview.surfaceFailed`
 *     and offers an in-place Retry (`dialog:errorBoundary.tryAgain`) that
 *     bumps the lazy key — a fresh thunk evaluation, not a re-render of a
 *     cached rejection. It replaced the older reuse of
 *     `editor:preview.failedToLoad`, which could not name the surface.
 *
 * @coordinates-with lib/formats/lazySurfaces.ts — resolution cache + typed error
 * @coordinates-with components/Editor/Editor.tsx — the dispatcher that mounts this
 * @module components/Editor/FormatSurface
 */
import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { FormatSurfaceLoadError, resolveFormatSurface } from "@/lib/formats/lazySurfaces";
import { localizedFormatName } from "@/lib/formats/saveFilters";
import type { FormatConfig } from "@/lib/formats/types";

interface FormatSurfaceProps {
  formatConfig: FormatConfig;
  tabId: string;
}

interface BoundaryProps {
  formatId: string;
  fallback: (error: unknown) => ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
}

/**
 * Catches the thunk rejection Suspense re-throws. A function component cannot
 * do this — error boundaries are still class-only in React 19.
 */
class SurfaceErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error != null) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

/** The visible failure state. Named so a test can assert on it by role.
 *  WI-UI4.4: it names the SURFACE (which format stopped working) and offers
 *  an in-place Retry — the canonical `.vm-btn` — wired by the parent to bump
 *  the lazy key, so the retry is a fresh thunk evaluation, not a re-render of
 *  a cached rejection. */
function SurfaceLoadFailure({ formatId, onRetry }: { formatId: string; onRetry: () => void }) {
  const { t } = useTranslation("editor");
  // Format display names live in the COMMON namespace ("format.txt" → "Plain
  // Text") — the editor namespace has no format.* keys, so an editor-scoped
  // lookup silently fell through to the raw id via defaultValue.
  const name = localizedFormatName(`format.${formatId}`, formatId);
  return (
    <div
      className="editor-content format-surface-error"
      role="alert"
      data-format-surface-error={formatId}
    >
      <p>{t("preview.surfaceFailed", { format: name })}</p>
      <button type="button" className="vm-btn" onClick={onRetry}>
        {i18n.t("dialog:errorBoundary.tryAgain")}
      </button>
    </div>
  );
}

export function FormatSurface({ formatConfig, tabId }: FormatSurfaceProps) {
  // WI-UI4.4: bumping the key remounts MountedSurface, which gives a FRESH
  // React.lazy (so the memoized rejection dies) and a fresh error boundary.
  const [retryKey, setRetryKey] = useState(0);
  return (
    <MountedSurface
      key={retryKey}
      formatConfig={formatConfig}
      tabId={tabId}
      onRetry={() => setRetryKey((k) => k + 1)}
    />
  );
}

function MountedSurface({
  formatConfig,
  tabId,
  onRetry,
}: FormatSurfaceProps & { onRetry: () => void }) {
  const { id, wysiwygComponent } = formatConfig;

  // ONE lazy object per mount, created by the state initializer rather than a
  // module-level map. React.lazy memoizes a REJECTED promise for the lifetime
  // of the object it belongs to, so a shared one would make a single transient
  // failure permanent — sticky semantics D4 rejects. Per-mount is what makes
  // "the next mount retries" true, and it costs nothing on the success path
  // because `resolveFormatSurface` caches the resolved module.
  //
  // Not `useMemo`: memo results are advisory (React may discard them) and the
  // config cannot change under a mounted FormatSurface anyway — Editor.tsx
  // keys it by `${tabId}-${formatId}`, so a format change is a remount.
  const [Surface] = useState(() =>
    lazy(() => {
      if (typeof wysiwygComponent !== "function") {
        // registerFormat rejects this shape; reaching it means the config
        // bypassed registration. Fail loudly into the boundary rather than
        // rendering an empty editor.
        return Promise.reject(
          new FormatSurfaceLoadError(
            id,
            "wysiwygComponent",
            new Error("format declares no wysiwygComponent thunk"),
          ),
        );
      }
      return resolveFormatSurface(id, "wysiwygComponent", wysiwygComponent);
    }),
  );

  return (
    <SurfaceErrorBoundary
      formatId={id}
      fallback={() => <SurfaceLoadFailure formatId={id} onRetry={onRetry} />}
    >
      <Suspense fallback={null}>
        <Surface tabId={tabId} />
      </Suspense>
    </SurfaceErrorBoundary>
  );
}
