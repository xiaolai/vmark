/**
 * overlayPolicies — every app-level overlay declares an occlusion policy (WI-SOC.1).
 *
 * The native `WKWebView` is a sibling native view added ABOVE the Tauri webview, so it
 * paints over **all** React DOM inside its rect. z-index cannot reach it. Any overlay
 * that can land in that rect must therefore freeze the browser while it is up.
 *
 * The first attempt at this was a hand-written table in the plan — and the cross-model
 * review found a missing entry (`ContentSearch`) on its first read. That is the whole
 * problem with a list: it is a snapshot of one day's `App.tsx`, and the gate passes
 * while an unlisted overlay quietly paints under a live web page. So the list lives
 * here as *code*, and `overlayOcclusion.test.ts` reads `App.tsx` and fails if any
 * overlay rendered there is missing a policy. Adding an overlay without deciding what
 * it does about the browser is now a build failure, not an oversight.
 *
 * Policies:
 * - `freeze` — hide the native view while this overlay is up. The default, and correct
 *   for everything, because `BrowserSurface` paints an opaque placeholder in the
 *   vacated rect (WI-SOC.1b) so even a translucent backdrop composites over a real
 *   surface rather than a blank hole.
 * - `no-overlap` — provably cannot intersect the browser rect. Must say WHY.
 *
 * There is deliberately no `snapshot` policy. A page snapshot is a fidelity
 * improvement, not a correctness requirement (ADR-10): for every overlay below, the
 * user is doing something *other than* reading the page, so the picture behind the
 * overlay is not load-bearing.
 *
 * @coordinates-with components/Browser/BrowserSurface — paints the frozen placeholder
 * Pure data — no React. The hook that applies these lives in
 * `hooks/useBrowserOccluder.ts` (ADR-013: services/ may not import React).
 *
 * @coordinates-with hooks/useBrowserOccluder — applies the freeze
 * @module services/browser/overlayPolicies
 */
export type OcclusionPolicy = { kind: "freeze" } | { kind: "no-overlap"; because: string };

/**
 * Every overlay rendered in `App.tsx`'s overlay slot, and what it does about the
 * browser. The test cross-checks this against the file — a new overlay with no entry
 * fails the build.
 */
export const OVERLAY_POLICIES: Record<string, OcclusionPolicy> = {
  // Take-over surfaces centred on the editor area: squarely inside the browser rect.
  CommandPalette: { kind: "freeze" },
  QuickOpen: { kind: "freeze" },
  GeniePickerOverlay: { kind: "freeze" },
  ContentSearch: { kind: "freeze" },
  KnowledgeBaseOverlay: { kind: "freeze" },
  WindowStatusOverlay: { kind: "freeze" },
  QuickLookOverlay: { kind: "freeze" },
  DropOverlay: { kind: "freeze" },
  ApprovalDialog: { kind: "freeze" },

  // The browser's own consent prompt freezes the tab the request targets — it does so
  // itself rather than through `useBrowserOccluder`, because a blanket freeze of every
  // mounted browser would be wrong: only one tab is being asked about.
  BrowserApprovalDialog: { kind: "freeze" },

  // Editor-only: a browser tab mounts BrowserSurface *instead of* an editor, so there
  // is no ProseMirror/CodeMirror surface to raise a context menu from over one.
  EditorContextMenu: {
    kind: "no-overlap",
    because:
      "raised from a ProseMirror/CodeMirror context-menu event; a browser tab mounts " +
      "BrowserSurface instead of an editor, so there is no surface to raise it from",
  },

  // --- Not in App.tsx: surfaces that open UPWARD out of the bottom bar. ---
  // The bar itself sits below the browser rect (that is why the omnibox is safe), but
  // anything that opens up out of it lands inside the rect. These are mounted only
  // while shown, so they freeze for their whole lifetime.
  TabContextMenu: { kind: "freeze" },
  WordCountPopover: { kind: "freeze" },
};
