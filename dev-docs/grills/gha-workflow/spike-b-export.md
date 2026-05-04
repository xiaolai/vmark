# Spike B — `html-to-image` + `@xyflow/react` v12 export pipeline

> Status: **PASS** (2026-05-04)
> Plan ADR: ADR-8
> Probe: `probes/spike-b-runner.mjs` + `spike-b-app.tsx` + `spike-b.html`
> Run with: `node spike-b-runner.mjs`

## Goal

Verify `html-to-image` produces SVG and PNG output from a live
`@xyflow/react` v12 canvas, in both light and dark themes, with CSS
variables resolving correctly, under a 1500ms threshold per export.

## Method

Headless Playwright (Chromium) drives a Vite-served React playground:

1. Mount `<ReactFlow>` with 20 custom-styled nodes consuming `--bg-color`,
   `--text-color`, `--border-color`.
2. Call `toSvg()` on `.react-flow__viewport`. Time it.
3. Call `toPng()` with `pixelRatio: 2`. Time it.
4. Apply `.dark-theme` class to `<html>`. Re-export both.
5. Capture `data:image/svg+xml...` and `data:image/png;base64...` outputs;
   verify shape and byte counts.

## Findings

| Test | Result | Notes |
|---|---|---|
| Light SVG produced | ✓ | 47.7 ms · 860 635 bytes |
| Light PNG produced | ✓ | 74.3 ms · 196 414 bytes (2× resolution) |
| Dark SVG produced | ✓ | 44.5 ms · 863 419 bytes |
| Dark PNG produced | ✓ | 59.3 ms · 197 026 bytes |
| All outputs valid (correct data URI prefix) | ✓ | |
| CSS vars inlined (computed colors visible in SVG) | ✓ | |
| Background color from CSS var resolves | ✓ | |
| Off-screen mount works | n/a (deferred) | not yet tested; expected to work given the basic export does |
| Export time ≤ 1500 ms on 20-node graph | ✓ | All four exports under 80 ms |

**Run output:**

```
{
  "done": true,
  "results": {
    "light": {
      "svg": { "ms": 47.7, "bytes": 860635, "valid": true },
      "png": { "ms": 74.3, "bytes": 196414, "valid": true }
    },
    "dark":  {
      "svg": { "ms": 44.5, "bytes": 863419, "valid": true },
      "png": { "ms": 59.3, "bytes": 197026, "valid": true }
    },
    "cssVarsResolved": true,
    "nodeCount": 20
  }
}
```

## API summary (for Phase 4 implementation)

```ts
import { toSvg, toPng } from "html-to-image";

const viewport = document.querySelector(".react-flow__viewport") as HTMLElement;
const svgDataUri = await toSvg(viewport, { cacheBust: true });
const pngDataUri = await toPng(viewport, { cacheBust: true, pixelRatio: 2 });
```

`html-to-image` produces `data:image/svg+xml;charset=utf-8,...` and
`data:image/png;base64,...` URIs. For file save, decode and write bytes;
for clipboard, set the data URI directly.

## Caveats and follow-ups

1. **SVG bytes are large** (~860 KB for 20 nodes, ~30 lines of CSS). Most of
   this is style-inlining — `html-to-image` walks computed styles and emits
   them inline on every element. For a 100-node workflow we should expect
   ~3-4 MB SVGs. Acceptable for download; possibly excessive for
   clipboard. Phase 4 should test on a 100-node graph.
2. **SVG uses `<foreignObject>`** to wrap the DOM tree (it's not native
   SVG primitives). This renders correctly in modern Chromium-based
   targets but may break in older PDF/print pipelines. Documented as the
   v1 trade-off in ADR-8; native-SVG export is a v2 enhancement option.
3. **Off-screen mount** (export from a workflow whose panel isn't
   currently visible) was not tested in the spike but is a known
   `html-to-image` capability — the only constraint is that the source
   element must be in the DOM and have non-zero size when the export
   runs. Phase 4 acceptance test must cover this explicitly.
4. **Font handling**: `html-to-image` embeds fonts via
   `getComputedStyle().fontFamily`. If VMark uses a custom font that
   isn't system-installed, the SVG/PNG may render with a fallback. Phase
   4 should add `fontEmbedCSS` option testing.
5. **Cache busting** flag is set in the spike (`cacheBust: true`). For
   production, leave it off after verifying — saves a query string round
   trip per asset.

## Decision

**Adopt `html-to-image` for Phase 4 SVG/PNG export.** Add to dependencies
per §9 of the plan. The SVG-via-foreignObject limitation stands as
documented; native-SVG export deferred to v2 if user feedback demands.

## Open follow-ups for Phase 4

1. Test export on 100-node graph; verify SVG size and timing.
2. Test off-screen mount path (export from a workflow whose panel is not
   currently visible — uses a hidden `<div>` to mount + export +
   unmount).
3. Test in VMark's actual font stack (`--font-sans`, `--font-mono`) to
   verify fonts render.
4. Add `fontEmbedCSS` if a custom font isn't system-installed.
