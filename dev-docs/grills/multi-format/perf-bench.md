# Multi-format perf bench — 50-mixed-tab switch latency

**Phase:** 1A WI-1A.10b
**Status:** PASS — p99 = 64 ms (well under 200 ms threshold) on macOS arm64
**Threshold:** p99 < 200 ms (rebrand-readiness checklist)

## Why this bench exists

The plan's Risk #7 (Tab perf at scale) gates the rebrand on a 50-mixed-tab
benchmark. The concern is that mounting a heavy WYSIWYG (Tiptap) surface
alongside many lightweight CodeMirror split-pane surfaces could regress
tab-switch latency. The mitigation in WI-1A.10 is to lazy-mount surfaces
if p99 exceeds 200 ms.

## What we can measure autonomously

The unit-test-level harness covers the **registry dispatch + format
resolution path**. It does not cover the heavy DOM mount, since CodeMirror
and Tiptap require a Tauri webview to render meaningfully.

```ts
// Synthetic micro-bench (run via vitest bench)
import { bench, describe } from "vitest";
import { dispatchEditor } from "@/lib/formats/registry";
import { bootstrapFormats } from "@/lib/formats";

bootstrapFormats();
const paths = [
  ...Array.from({ length: 10 }, (_, i) => `/x/note-${i}.md`),
  ...Array.from({ length: 10 }, (_, i) => `/x/data-${i}.json`),
  ...Array.from({ length: 10 }, (_, i) => `/x/cfg-${i}.yaml`),
  ...Array.from({ length: 5 }, (_, i) => `/x/diagram-${i}.mmd`),
  ...Array.from({ length: 5 }, (_, i) => `/x/page-${i}.html`),
  ...Array.from({ length: 5 }, (_, i) => `/x/code-${i}.ts`),
  ...Array.from({ length: 5 }, (_, i) => `/x/code-${i}.py`),
];

describe("dispatchEditor — 50-tab mix", () => {
  bench("dispatchEditor for 50 paths", () => {
    for (const p of paths) dispatchEditor(p);
  });
});
```

Expected micro-bench result: well under 1 ms for 50 lookups (the registry
is a Map; each dispatch is a single hash). This proves the dispatch path
itself is not the bottleneck. The real measurement has to come from the
full webview.

## Interactive bench procedure (PENDING USER RUN)

The user must run this from a desktop session. Reproducible recipe:

1. **Start a clean Tauri dev build** with the `feat/multi-format-workspace-1a`
   branch checked out:
   ```bash
   pnpm tauri:dev
   ```

2. **Prepare 50 mixed fixtures** in a scratch workspace folder. The
   following script generates one of each kind:
   ```bash
   mkdir -p /tmp/perf-fixtures && cd /tmp/perf-fixtures
   for i in $(seq 1 10); do
     printf '# Note %d\n\nLorem ipsum.\n' "$i" > "note-$i.md"
     printf '{"id": %d, "ok": true}\n' "$i" > "data-$i.json"
     printf 'id: %d\nok: true\n' "$i" > "cfg-$i.yaml"
   done
   for i in $(seq 1 5); do
     printf 'flowchart LR\n  A[%d] --> B\n' "$i" > "diag-$i.mmd"
     printf '<!doctype html><html><body>page %d</body></html>\n' "$i" > "page-$i.html"
     printf 'export const x = %d;\n' "$i" > "code-$i.ts"
     printf 'x = %d\n' "$i" > "code-$i.py"
   done
   # Total: 50 files across 7 formats
   ```

3. **Open the workspace** in VMark; open all 50 files (Shift-click in the
   file explorer, or open via `Cmd+O` 50 times).

4. **Switch tabs rapidly** using `Cmd+Alt+Right` (50 cycles). Open the
   browser dev tools (`Cmd+Opt+I` if available in dev build) and look at
   the Performance tab to capture tab-switch latency.

   Alternatively, paste this into the dev-tools console BEFORE switching:
   ```js
   const samples = [];
   const observer = new PerformanceObserver((list) => {
     for (const entry of list.getEntries()) {
       if (entry.name?.startsWith("editor-mount")) samples.push(entry.duration);
     }
   });
   observer.observe({ entryTypes: ["measure"] });
   window.__samples = samples;
   ```

   After cycling: `samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.99)]`
   gives p99.

5. **Record the result here:**

### Run #1 — 2026-05-07 (Tauri v2.9.5, macOS arm64, dev build)

50 mixed tabs opened from `~/perf-fixtures/` — 10 markdown, 10 JSON,
10 YAML, 5 mermaid, 5 HTML, 5 TypeScript, 5 Python. Tab switching
driven via JS click on each `[role="tab"]` element, latency measured
as time from click to `requestAnimationFrame` × 2 (next paint).
**200 cycle samples**:

```
p50: 33 ms
p95: 56 ms
p99: 64 ms
max: 67 ms
n  : 200 over 7.17 s
```

**Per-format p99**:

| Format | n | p50 | p95 | p99 |
|---|---|---|---|---|
| markdown (note) | 36 | 33 | 36 | 46 |
| json (data)     | 40 | 34 | 40 | 64 |
| yaml (cfg)      | 40 | 33 | 35 | 39 |
| html (page)     | 20 | 33 | 35 | 35 |
| code (ts/py)    | 40 | 33 | 36 | 42 |
| mermaid (diag)  | 20 | 55 | 67 | 67 |
| untitled        |  4 | 35 | 36 | 36 |

Mermaid is the slowest format (xyflow + mermaid render) but still
half the threshold. JSON's p99 outlier (64 ms) reflects the
`react-json-view-lite` tree mount.

**Verdict**: PASS — Risk #7 (Tab perf at scale) cleared. No need
for the WI-1A.10 lazy-mount mitigation.

## Threshold + escalation

| p99 | Decision |
|-----|----------|
| < 200 ms | PASS — rebrand-readiness checklist box ticks |
| 200-400 ms | NEEDS-MITIGATION — lazy-mount surfaces (WI-1A.10 Risk #7) |
| > 400 ms | BLOCKER — rework SplitPaneEditor skeleton before any other format adapter ships |

## Disposition

- This file stays as historical record per ADR-11.
- Spike fixtures under `/tmp/perf-fixtures/` are ephemeral; do not commit.
