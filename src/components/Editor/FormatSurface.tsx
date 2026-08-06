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
 *   - The error state reuses `editor:preview.failedToLoad` rather than adding
 *     a string: it says exactly this, in all ten locales, today.
 *
 * @coordinates-with lib/formats/lazySurfaces.ts — resolution cache + typed error
 * @coordinates-with components/Editor/Editor.tsx — the dispatcher that mounts this
 * @module components/Editor/FormatSurface
 */
import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormatSurfaceLoadError, resolveFormatSurface } from "@/lib/formats/lazySurfaces";
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

/** The visible failure state. Named so a test can assert on it by role. */
function SurfaceLoadFailure({ formatId }: { formatId: string }) {
  const { t } = useTranslation("editor");
  return (
    <div
      className="editor-content format-surface-error"
      role="alert"
      data-format-surface-error={formatId}
    >
      {t("preview.failedToLoad")}
    </div>
  );
}

export function FormatSurface({ formatConfig, tabId }: FormatSurfaceProps) {
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
      fallback={() => <SurfaceLoadFailure formatId={id} />}
    >
      <Suspense fallback={null}>
        <Surface tabId={tabId} />
      </Suspense>
    </SurfaceErrorBoundary>
  );
}
