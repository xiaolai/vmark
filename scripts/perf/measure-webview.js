/**
 * VMark WebKit Performance Measurement Payload
 *
 * Self-contained measurement script for the Tiptap editor inside VMark's
 * actual WebView. Designed to be executed via Tauri MCP's
 * `tauri_webview_execute_js` tool against a running debug build (the MCP
 * bridge is `#[cfg(debug_assertions)]` — see src-tauri/src/lib.rs:728).
 *
 * Why this exists:
 *   `pnpm bench:editor` measures plugin/transaction cost in jsdom — it does
 *   NOT exercise WebKit layout/paint. The "80 KB doc freezes for 144 s"
 *   issue documented in dev-docs/archive/large-file-performance-investigation.md
 *   is purely a WebKit cost. This payload measures it.
 *
 * What it measures:
 *   - mountMs           wall-clock time from `new Editor` call to first paint
 *   - firstPaintMs      time from setContent() to next requestAnimationFrame
 *   - typingP50/P95/P99 per-keystroke dispatch-to-rAF latency (ms) over N
 *                       synthetic insertText transactions
 *   - longTaskCount     PerformanceObserver longtask entries during typing
 *   - longTaskTotalMs   sum of long-task durations (>50 ms blocking events)
 *
 * Usage from the AI assistant:
 *   1. Start a debug build of VMark:  pnpm tauri:dev
 *   2. Connect:                       tauri_driver_session(action: "start", port: <vmark debug port>)
 *   3. Open the fixture file in VMark: tauri_webview_execute_js(...) calling
 *      the helper at the bottom of this file via IIFE.
 *
 * Caveats:
 *   - Requires the active editor to be reachable via the documented hooks.
 *     VMark stores it on the global ActiveEditorStore — see helper below.
 *   - Numbers vary 10-30% between runs in WebKit (GC, paint scheduling,
 *     macOS thermal throttling). Run 3+ times and take the median.
 *
 * @module scripts/perf/measure-webview
 */

/**
 * Snapshot of measurement results. JSON-serializable so it can return
 * through `tauri_webview_execute_js`.
 */
// Type sketch (informal — this file is plain JS that runs in the WebView):
// interface PerfReport {
//   doc: { kind: string; bytes: number; nodes: number };
//   mountMs: number;
//   firstPaintMs: number;
//   typingP50: number;
//   typingP95: number;
//   typingP99: number;
//   typingMean: number;
//   typingSamples: number;
//   longTaskCount: number;
//   longTaskTotalMs: number;
//   userAgent: string;
//   timestamp: string;
// }

/* eslint-disable */

(function defineMeasurePayload() {
  /**
   * Returns the active Tiptap EditorView from VMark's ActiveEditorStore,
   * or null if no editor is currently mounted (e.g. settings window).
   *
   * Uses the `useTiptapEditorStore` exposed via VMark's debug surface.
   * If the surface isn't there (older builds), falls back to a DOM probe.
   */
  function getActiveEditorView() {
    // Preferred: the store is published on window in dev builds via
    // src/utils/debug.ts when DEBUG=true. Fall back to DOM probe.
    /** @type {any} */
    const w = window;
    if (w.__VMARK_DEBUG__?.editorView) return w.__VMARK_DEBUG__.editorView;

    // DOM probe: ProseMirror sets a `.ProseMirror` class on the editable.
    const el = document.querySelector(".ProseMirror");
    if (!el) return null;
    // ProseMirror's view stores itself on the DOM via a private symbol;
    // the only public way to retrieve it is through the editor instance.
    // For perf measurement we don't need the view object — we need a way
    // to time `view.dispatch`. We'll rely on the global hook below.
    return el;
  }

  /**
   * Wait for the next paint and resolve with the time elapsed since the
   * marker `from` (default: now).
   */
  function nextPaintMs(from = performance.now()) {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        // Two RAFs: first fires before paint commits, second after paint.
        // For "first paint" measurement, the second RAF is closer to truth.
        requestAnimationFrame(() => resolve(performance.now() - from));
      });
    });
  }

  /**
   * Fire `count` synthetic single-char insertions through the editor and
   * record per-insert dispatch-to-paint latency. The PerformanceObserver
   * disconnect is in a `finally` so a thrown insert (or torn-down view)
   * cannot leave an orphaned observer attached to the global, which would
   * pollute subsequent runs.
   *
   * Returns { samples: number[], longTaskCount: number, longTaskTotalMs: number }
   */
  async function measureTyping(view, count) {
    const samples = [];
    let longTaskCount = 0;
    let longTaskTotalMs = 0;

    // PerformanceObserver for long tasks (>50 ms blocking the main thread).
    // `longtask` entry type may not be supported in older WebKit; guard it.
    let observer = null;
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longTaskTotalMs += entry.duration;
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // No longtask support — leave counters at 0 and continue.
    }

    try {
      for (let i = 0; i < count; i += 1) {
        const start = performance.now();
        // `addToHistory: false` keeps the synthetic inserts out of the
        // user's undo stack — measurement must not be observable as 100
        // accumulated undo entries when the user later presses Cmd+Z.
        view.dispatch(view.state.tr.insertText("a", 1).setMeta("addToHistory", false));
        const elapsed = await nextPaintMs(start);
        samples.push(elapsed);
      }
    } finally {
      observer?.disconnect();
    }

    return { samples, longTaskCount, longTaskTotalMs };
  }

  function percentile(sortedSamples, p) {
    if (sortedSamples.length === 0) return 0;
    const idx = Math.min(
      sortedSamples.length - 1,
      Math.floor((p / 100) * sortedSamples.length),
    );
    return sortedSamples[idx];
  }

  function mean(samples) {
    if (samples.length === 0) return 0;
    return samples.reduce((acc, n) => acc + n, 0) / samples.length;
  }

  /**
   * Restore the editor to the snapshot's doc. Uses ProseMirror's standard
   * "replaceWith over the whole content" pattern.
   *
   * Selection is restored from `snapshot.selectionJson` via Selection.fromJSON
   * — `.map()` after a full-doc replace would collapse the cursor to the doc
   * end because the mapping deletes all original positions and re-inserts new
   * ones. fromJSON works because the restored doc is byte-equal to the
   * snapshot, so the original positions are valid as-is.
   *
   * The dispatch carries `addToHistory: false` so the restore — and the
   * synthetic-insert transactions before it — leave no entries in the
   * user's undo stack. Cmd+Z after a `measure()` run jumps back past the
   * measurement entirely.
   */
  function restoreSnapshot(view, snapshot) {
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      snapshot.docContent,
    );
    try {
      const SelectionCtor = view.state.selection.constructor;
      // Most Selection subclasses (TextSelection, NodeSelection, AllSelection)
      // expose a static `fromJSON(doc, json)`. Use the same constructor
      // family that produced the snapshot so the type round-trips.
      if (SelectionCtor && typeof SelectionCtor.fromJSON === "function") {
        tr.setSelection(SelectionCtor.fromJSON(tr.doc, snapshot.selectionJson));
      }
    } catch {
      // Selection couldn't be re-applied (very rare for same-content restore).
      // Leave the cursor wherever the dispatch landed it; not worth failing
      // the whole measurement over.
    }
    view.dispatch(tr.setMeta("addToHistory", false));
  }

  /**
   * UTF-8 byte length of the doc's plain text. The naive `string.length`
   * counts UTF-16 code units, which under-counts CJK and emoji. TextEncoder
   * gives the byte size that matches what most "doc size" intuitions expect.
   */
  function utf8ByteLength(str) {
    if (typeof TextEncoder === "undefined") return str.length;
    return new TextEncoder().encode(str).length;
  }

  /**
   * Top-level entry point. Caller passes:
   *   - view: a ProseMirror EditorView (the active Tiptap view)
   *   - typingCount: number of synthetic keystrokes (default 100)
   *   - docKind: optional label for the report (e.g. "performance-test.md")
   *
   * Returns a JSON-serializable PerfReport.
   *
   * Idempotency: the doc and selection are snapshotted before measurement
   * and restored in `finally` regardless of outcome. The user's open
   * document is byte-equal before and after this call. Every dispatch
   * carries `addToHistory: false`, so the user's undo stack is untouched —
   * Cmd+Z after a `measure()` run jumps back past the measurement entirely.
   */
  async function measure(view, typingCount = 100, docKind = "unknown") {
    if (!view || typeof view.dispatch !== "function") {
      throw new Error("measure(): view must be a ProseMirror EditorView");
    }

    const docBytes = utf8ByteLength(view.state.doc.textContent);
    let nodes = 0;
    view.state.doc.descendants(() => {
      nodes += 1;
      return true;
    });

    // Snapshot the doc content (immutable in PM, safe to hold a reference)
    // and the selection in JSON form so the restore can use fromJSON instead
    // of .map() — see restoreSnapshot for why mapping doesn't work here.
    const snapshot = {
      docContent: view.state.doc.content,
      selectionJson: view.state.selection.toJSON(),
    };

    let firstPaintMs = 0;
    let typing = { samples: [], longTaskCount: 0, longTaskTotalMs: 0 };
    try {
      // First-paint baseline: dispatch a no-op transaction and measure rAF.
      // (We can't re-mount the editor inside the live app without disrupting
      // the user's session.) This gives a "current state of paint" reading.
      const paintStart = performance.now();
      view.dispatch(view.state.tr);
      firstPaintMs = await nextPaintMs(paintStart);

      // Typing latency over `typingCount` keystrokes.
      typing = await measureTyping(view, typingCount);
    } finally {
      restoreSnapshot(view, snapshot);
    }

    const sorted = [...typing.samples].sort((a, b) => a - b);

    return {
      doc: { kind: docKind, bytes: docBytes, nodes },
      // mountMs is only meaningful when called immediately after `new Editor`.
      // Live measurement against an already-mounted editor reports 0.
      mountMs: 0,
      firstPaintMs: Math.round(firstPaintMs * 100) / 100,
      typingP50: Math.round(percentile(sorted, 50) * 100) / 100,
      typingP95: Math.round(percentile(sorted, 95) * 100) / 100,
      typingP99: Math.round(percentile(sorted, 99) * 100) / 100,
      typingMean: Math.round(mean(typing.samples) * 100) / 100,
      typingSamples: typing.samples.length,
      longTaskCount: typing.longTaskCount,
      longTaskTotalMs: Math.round(typing.longTaskTotalMs * 100) / 100,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
  }

  // Publish on window so MCP execute_js can reach the helpers via IIFE.
  /** @type {any} */
  const w = window;
  w.__VMARK_PERF__ = {
    getActiveEditorView,
    measure,
    nextPaintMs,
    measureTyping,
    restoreSnapshot,
    utf8ByteLength,
  };

  return "vmark-perf-loaded";
})();
