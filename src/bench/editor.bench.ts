/**
 * Editor (Tiptap + ProseMirror) Benchmarks
 *
 * Why this file exists:
 *   `largeFile.bench.ts` measures pure ProseMirror `state.apply()` cost — it
 *   does NOT exercise the Tiptap plugin stack (no `view.update`, no plugin
 *   `view`-layer work, no decoration rebuild via the view). This file mounts
 *   a real `Editor` with VMark's full extension stack so plugin `apply()`
 *   chains (codePreview, search, CJK letter-spacing, lint, etc.) are part
 *   of every measured transaction.
 *
 * What this file does NOT measure:
 *   - WebKit layout/paint of contenteditable. The well-known "80 KB doc
 *     freezes for 144 s" issue lives in WebKit's text-shaping/layout pass,
 *     not in JS. jsdom has no real layout engine — measurements here are
 *     JS-side only. For real WebKit numbers, drive the running app via
 *     Tauri MCP and read `performance.now()` in the WebView console.
 *   - React NodeViews mount cost (block_video, block_audio, frontmatter
 *     panel, etc). They instantiate but jsdom doesn't paint them, so the
 *     cost we observe is the constructor + initial render only.
 *
 * Run:
 *   pnpm bench:editor
 *   pnpm bench src/bench/editor.bench.ts
 *
 * What to do with the numbers:
 *   - Capture a baseline ON MAIN, then re-run after a change.
 *   - Within-run noise on jsdom is usually under 5%; treat ±10% as the
 *     floor for "real" change. See vitest's bench output for the per-bench
 *     stddev and margin of error.
 *
 * @module bench/editor
 */

import { bench, describe } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { createTiptapExtensions } from "@/utils/tiptapExtensions";
import {
  generateMarkdown,
  generateMarkdownWithCodeBlocks,
} from "./helpers";

// ---------------------------------------------------------------------------
// Fixtures (built once at module load — outside the measured region)
// ---------------------------------------------------------------------------

const mdSmall = generateMarkdown(500); //  ~10 KB
const mdMedium = generateMarkdown(2_500); //  ~50 KB
const mdLarge = generateMarkdown(8_000); // ~160 KB

// 199 fenced ```mermaid blocks scattered through 5_000 top-level nodes.
// (Math: i=0 is excluded from the block test, so blocks land at i=25,50,…,4975
//  → exactly 199 blocks.) Used to stress codePreview's fast-path: before E1,
// each keystroke OUTSIDE any code block paid an O(top-level-blocks)
// `newState.doc.forEach` walk regardless. After E1, that walk only runs
// when the cheap intersect check suggests it could succeed.
const mdWithCodeBlocks = generateMarkdownWithCodeBlocks(5_000, 25, "mermaid");

// ---------------------------------------------------------------------------
// Editor mount helper
// ---------------------------------------------------------------------------

/**
 * Mount a Tiptap editor in a fresh container appended to document.body.
 * Returns both the editor and a `dispose` callback that destroys the editor
 * AND removes the container — call it from every bench iteration so the
 * benches don't accumulate DOM nodes (which would skew successive samples).
 */
function mountEditor(content: string): { editor: Editor; dispose: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createTiptapExtensions(),
    content,
  });
  return {
    editor,
    dispose: () => {
      editor.destroy();
      element.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Mount / setContent — the "open file" cost
// ---------------------------------------------------------------------------

describe("editor mount + setContent (open path)", () => {
  bench(
    "small (~10 KB)",
    () => {
      const { dispose } = mountEditor(mdSmall);
      dispose();
    },
    { iterations: 10, warmupIterations: 2 },
  );

  bench(
    "medium (~50 KB)",
    () => {
      const { dispose } = mountEditor(mdMedium);
      dispose();
    },
    { iterations: 5, warmupIterations: 1 },
  );

  bench(
    "large (~160 KB)",
    () => {
      const { dispose } = mountEditor(mdLarge);
      dispose();
    },
    // 3 iterations → wide CI; this bench is a coarse trend indicator only.
    // Don't gate single-run regressions on it. See header comment.
    { iterations: 3, warmupIterations: 1 },
  );
});

// ---------------------------------------------------------------------------
// Per-keystroke transaction cost — the "typing" hot path
//
// We bench `state.apply(tr)` against a snapshot taken from a MOUNTED editor.
// Mounting first is what loads the full plugin stack into the schema/state,
// so each transaction runs every plugin's `apply()` (codePreview, CJK
// spacing, etc.). We avoid `view.dispatch(tr)` here so successive iterations
// don't accumulate edits in the editor's live state — every iteration starts
// from the same base.
// ---------------------------------------------------------------------------

function snapshotState(content: string): EditorState {
  const { editor, dispose } = mountEditor(content);
  const state = editor.state;
  dispose();
  return state;
}

describe("typing — 100 single-char inserts (plugin apply chain)", () => {
  const stateSmall = snapshotState(mdSmall);
  const stateMedium = snapshotState(mdMedium);
  const stateLarge = snapshotState(mdLarge);

  bench("small (~10 KB)", () => {
    let state = stateSmall;
    for (let i = 0; i < 100; i++) {
      state = state.apply(state.tr.insertText("a", 1));
    }
  });

  bench("medium (~50 KB)", () => {
    let state = stateMedium;
    for (let i = 0; i < 100; i++) {
      state = state.apply(state.tr.insertText("a", 1));
    }
  });

  bench("large (~160 KB)", () => {
    let state = stateLarge;
    for (let i = 0; i < 100; i++) {
      state = state.apply(state.tr.insertText("a", 1));
    }
  });
});

// ---------------------------------------------------------------------------
// codePreview cost-of-blocks reference
//
// Documents how code-block density affects per-keystroke cost when typing
// OUTSIDE every block (the fast-path scenario). Useful as a reference and
// for catching future regressions that scale with block count (e.g. an
// added inner loop, or a fast-path accidentally disabled). NOT a tight
// guard for E1's specific reorder — that fix saves ~1% per keystroke,
// which is below jsdom bench noise (RME ~12-15%). Treat the ratio as a
// trend indicator across many runs, not a single-run pass/fail.
// ---------------------------------------------------------------------------

describe("typing — cost of code-block density (codePreview reference)", () => {
  // Apples-to-apples: same total top-level node count, only code-block
  // density differs. This isolates the marginal per-block cost from any
  // cost that scales with overall doc size.
  const stateNoBlocks = snapshotState(generateMarkdown(5_000));
  const stateManyBlocks = snapshotState(mdWithCodeBlocks);

  bench("5_000 nodes, 0 code blocks", () => {
    let state = stateNoBlocks;
    for (let i = 0; i < 100; i++) {
      state = state.apply(state.tr.insertText("a", 1));
    }
  });

  bench("5_000 nodes, 199 mermaid code blocks", () => {
    let state = stateManyBlocks;
    for (let i = 0; i < 100; i++) {
      state = state.apply(state.tr.insertText("a", 1));
    }
  });
});

// ---------------------------------------------------------------------------
// Doc walk baseline — what does an O(n) descendant scan cost?
// Useful as a "speed of light" reference: any plugin path slower than this
// is doing more than a single doc walk.
// ---------------------------------------------------------------------------

describe("doc walk baselines", () => {
  const docSmall = snapshotState(mdSmall).doc;
  const docMedium = snapshotState(mdMedium).doc;
  const docLarge = snapshotState(mdLarge).doc;

  bench("descendants walk — small", () => {
    let count = 0;
    docSmall.descendants(() => {
      count++;
      return true;
    });
    if (count < 0) throw new Error("unreachable");
  });

  bench("descendants walk — medium", () => {
    let count = 0;
    docMedium.descendants(() => {
      count++;
      return true;
    });
    if (count < 0) throw new Error("unreachable");
  });

  bench("descendants walk — large", () => {
    let count = 0;
    docLarge.descendants(() => {
      count++;
      return true;
    });
    if (count < 0) throw new Error("unreachable");
  });
});
