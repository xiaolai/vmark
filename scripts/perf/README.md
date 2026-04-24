# VMark WebKit Perf Scenarios

Real-WebView performance measurement for VMark, driven by the AI assistant
through the Tauri MCP bridge. Complements `pnpm bench:editor` — that bench
runs in jsdom (no layout/paint), this scenario runs in the actual WebKit
WebView the user ships.

## Why this exists

The well-documented "80 KB doc freezes for 144 s" issue
(`dev-docs/archive/large-file-performance-investigation.md`) is a WebKit
layout/paint cost. JavaScript benchmarks miss it entirely. This scenario
measures it directly:

- **first-paint** — time from a no-op transaction dispatch to the next
  rendered frame. A proxy for "is WebKit busy?"
- **per-keystroke latency p50/p95/p99** — over 100 synthetic
  `view.dispatch(insertText)` calls, time from dispatch to next paint.
- **long-task count + total ms** — `PerformanceObserver` longtask entries
  during the typing burst (>50 ms blocks).

## What you need

1. **A debug build of VMark must be running.** The Tauri MCP bridge plugin
   is `#[cfg(debug_assertions)]` — release builds (`/Applications/VMark.app`)
   don't expose it.
2. **The debug build's MCP bridge port.** It defaults to a random port at
   startup; find it via `lsof -iTCP -sTCP:LISTEN -P | grep vmark` after the
   app boots. (The default in `tauri-plugin-mcp-bridge` ≥0.8 is 9223 unless
   another app on the host already grabbed it — Claudepot does, in many
   dev setups.)
3. **The MCP server connected** — `npx -y @hypothesi/tauri-mcp-server` (already
   wired in `.mcp.json`).

## Run it

### Step 1 — start a debug VMark

```bash
pnpm tauri:dev
# Wait for the window to appear, then in another shell:
lsof -iTCP -sTCP:LISTEN -P | grep vmark | grep -v mcp-server
# → vmark    NNNN  joker  ... TCP localhost:PORT (LISTEN)
```

The bridge prints its port to the dev-server stderr too.

### Step 2 — open the perf fixture

Open `dev-docs/archive/performance-test.md` in VMark (drag-drop or File →
Open). This is the standard stress fixture — exercises every node type the
production editor renders.

### Step 3 — ask the AI to run the scenario

The reusable measurement helper lives in `scripts/perf/measure-webview.js`.
The AI assistant (or a human with MCP tools) executes it via Tauri MCP:

```
1. tauri_driver_session start at the port from step 1
2. tauri_webview_execute_js — paste the contents of measure-webview.js
   to register window.__VMARK_PERF__
3. tauri_webview_execute_js — run:
      (async () => {
        const view = window.__VMARK_DEBUG__?.editorView;
        if (!view) throw new Error("No active editor");
        return await window.__VMARK_PERF__.measure(view, 100, "performance-test.md");
      })()
4. The return value is a JSON PerfReport — capture and save under .perf-history/
```

### Step 4 — record the result

Append the JSON to `.perf-history/<YYYY-MM-DD>-<doc-kind>.jsonl` (one line
per run). Three runs taken back-to-back are usually enough to spot a
regression — within-run variance in WebKit is 10–30%.

`measure()` is idempotent: it snapshots the doc + selection before the
synthetic-keystroke loop and restores them in `finally`. Every dispatch
carries `addToHistory: false`, so the user's undo stack is **untouched**
— pressing Cmd+Z after a `measure()` run jumps back past the
measurement entirely. You can run `measure()` N times against the same
open document without manually resetting between runs.

## What the numbers mean

| Field | Healthy on M-series | Caution | Alarm |
|-------|---------------------|---------|-------|
| `firstPaintMs` (50 KB doc) | < 16 | 16–50 | > 50 |
| `typingP50` (50 KB doc) | < 4 | 4–16 | > 16 |
| `typingP95` (50 KB doc) | < 16 | 16–50 | > 50 |
| `typingP99` (50 KB doc) | < 50 | 50–150 | > 150 |
| `longTaskCount` (per 100 keystrokes) | 0 | 1–5 | > 5 |

These thresholds match a 60 Hz frame budget (16.6 ms/frame). Anything
above 50 ms means the user perceives stutter; anything above 150 ms means
visible freeze.

## Files

- `measure-webview.js` — the JS payload. Self-contained, runs in the
  WebView via execute_js.
- `README.md` — this file.

## Why this isn't automated in CI

- WebKit timing is sensitive to system load; CI runners are noisy.
- macOS-only (WebKit only ships on Apple platforms; Linux/Windows use
  WebView2 / WebKitGTK with different perf profiles).
- Requires a running app — not a pure unit harness.

The intended cadence is **before-release verification** plus **after any
change touching the editor pipeline** (Tiptap extensions, decorations,
node views, paint-affecting CSS).

## Related

- `pnpm bench:editor` — JS-only Tiptap bench (jsdom)
- `pnpm bench:markdown` — markdown parse/serialize bench
- `pnpm size` — bundle-size budget
- `dev-docs/archive/large-file-performance-investigation.md` — the original
  WebKit-rendering investigation that motivated this scenario.
