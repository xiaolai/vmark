/**
 * Purpose: Render a GitHub Actions workflow YAML to an SVG snapshot via
 *   the same xyflow + JobNode pipeline the side panel uses, captured
 *   once via html-to-image. Inline code-fence previews use this to get
 *   pixel-for-pixel parity with the standalone-file canvas — same node
 *   visuals (matrix badge, runner label, conditional dot, reusable
 *   badge) instead of Mermaid's plain rectangles.
 *
 *   Replaces the Mermaid-based inline render documented in ADR-9 of
 *   the GHA workflow viewer plan; rationale in
 *   dev-docs/plans/20260504-workflow-fence-snapshot.md.
 *
 * Architecture (plan ADR-2 + ADR-3 + ADR-4):
 *   - Single shared off-screen xyflow root. One persistent React root
 *     mounts at first render; every snapshot re-uses it via setNodes/
 *     setEdges. A doc with N fences pays one React mount cost.
 *   - Content-hash cache. Canonicalize the YAML (strip comments,
 *     trailing whitespace) and key the cached SVG on that. N identical
 *     fences across a doc produce 1 render + N-1 lookups.
 *   - FIFO single-flight queue. Snapshot requests serialize through one
 *     queue. Concurrent renders contend for layout + html-to-image's
 *     main-thread DOM walk; serializing eliminates contention.
 *
 * @coordinates-with src/lib/ghaWorkflow/parser/index.ts — YAML → IR
 * @coordinates-with src/lib/ghaWorkflow/render/toGraph.ts — IR → nodes/edges
 * @coordinates-with src/lib/ghaWorkflow/render/layout.ts — dagre positions
 * @coordinates-with src/components/Editor/WorkflowPanel/JobNode.tsx — node visuals
 * @coordinates-with src/plugins/codePreview/renderers/renderWorkflowPreview.ts — caller
 * @module lib/ghaWorkflow/render/renderXyflowSnapshot
 */

import { diagramWarn } from "@/utils/debug";

const CONTAINER_ID = "vmark-workflow-snapshot-root";
const CONTAINER_WIDTH = 800;
const CONTAINER_HEIGHT = 480;

interface QueueJob {
  yaml: string;
  resolve: (svg: string | null) => void;
}

interface ReactRootLike {
  render(node: unknown): void;
  unmount(): void;
}

interface SnapshotState {
  containerEl: HTMLDivElement | null;
  reactRoot: ReactRootLike | null;
  /** Memoized snapshot cache, keyed on canonicalized YAML. */
  cache: Map<string, string>;
  /** FIFO of pending snapshot requests. */
  queue: QueueJob[];
  /** True while a snapshot is in flight; prevents re-entrant queue drain. */
  processing: boolean;
}

const state: SnapshotState = {
  containerEl: null,
  reactRoot: null,
  cache: new Map(),
  queue: [],
  processing: false,
};

/** Function the queue dispatches to for each render — pluggable for tests. */
let renderImpl: ((yaml: string) => Promise<string | null>) | null = null;

/**
 * Strip line comments and trailing whitespace so byte-divergent but
 * semantically equal workflows share a cache key. Visible-only —
 * this is for cache keying, not for parsing.
 */
export function canonicalizeWorkflowYaml(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => {
      const hashIdx = line.indexOf("#");
      if (hashIdx < 0) return line.trimEnd();
      // Heuristic: an even number of quote characters before the # means
      // we're outside any quoted string — safe to treat the # as a
      // line comment. Imperfect, but a miss only costs a cache miss,
      // never a wrong cache hit.
      const before = line.slice(0, hashIdx);
      const quoteCount = (before.match(/["']/g) ?? []).length;
      if (quoteCount % 2 === 0) return before.trimEnd();
      return line.trimEnd();
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Mount the off-screen container + React root the first time a snapshot
 * is requested. Idempotent across the session.
 */
async function ensureContainer(): Promise<void> {
  if (state.containerEl !== null && state.reactRoot !== null) return;

  if (typeof document === "undefined") {
    throw new Error("renderXyflowSnapshot requires a DOM");
  }

  const div = document.createElement("div");
  div.id = CONTAINER_ID;
  div.setAttribute("aria-hidden", "true");
  // Off-screen, hidden, non-interactive. Width + height must be non-zero
  // or xyflow's fitView no-ops; the captured SVG uses its own viewBox so
  // the container size doesn't bleed into the output.
  div.style.cssText =
    "position: fixed;" +
    "left: -9999px;" +
    "top: 0;" +
    `width: ${CONTAINER_WIDTH}px;` +
    `height: ${CONTAINER_HEIGHT}px;` +
    "visibility: hidden;" +
    "pointer-events: none;";
  document.body.appendChild(div);
  state.containerEl = div;

  // Lazy-import react-dom + the renderer subtree so this file doesn't
  // pull React DOM into the eager bundle for users who never view a
  // workflow fence. The first dynamic-import warms the chunk; subsequent
  // calls hit the resolved promise.
  const [{ createRoot }, mod] = await Promise.all([
    import("react-dom/client"),
    import("./snapshotRoot"),
  ]);
  state.reactRoot = createRoot(div);
  // Default render hands setRender back to us via mod.attachTo().
  // Subsequent snapshots flow through that callback rather than re-
  // rendering the full tree.
  mod.attachTo(state.reactRoot);
  renderImpl = (yaml) => mod.captureSnapshot(yaml);
}

/**
 * Process the FIFO queue. One render at a time so concurrent calls
 * don't race on layout + html-to-image's main-thread DOM walk.
 */
async function drainQueue(): Promise<void> {
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.queue.length > 0) {
      const job = state.queue.shift();
      if (!job) continue;
      try {
        if (renderImpl === null) {
          await ensureContainer();
        }
        if (renderImpl === null) {
          throw new Error("Snapshot renderer is not initialized");
        }
        const svg = await renderImpl(job.yaml);
        job.resolve(svg);
      } catch (e) {
        diagramWarn(
          "Workflow snapshot render failed:",
          e instanceof Error ? e.message : String(e),
        );
        job.resolve(null);
      }
    }
  } finally {
    state.processing = false;
  }
}

/**
 * Render a workflow YAML string to an SVG snapshot. Returns null if
 * rendering fails (parser error, html-to-image failure, etc.) so the
 * caller can fall back to a textual error placeholder.
 *
 * Identical inputs (modulo comments + trailing whitespace) hit the
 * cache and resolve on the next microtask without enqueueing.
 */
export async function renderXyflowSnapshot(
  yaml: string,
): Promise<string | null> {
  const key = canonicalizeWorkflowYaml(yaml);
  const cached = state.cache.get(key);
  if (cached !== undefined) return cached;

  return new Promise((resolve) => {
    state.queue.push({
      yaml,
      resolve: (svg) => {
        if (svg !== null) state.cache.set(key, svg);
        resolve(svg);
      },
    });
    void drainQueue();
  });
}

/**
 * Test-only: clear the in-memory cache + queue and detach the React
 * root pointer. Lets each test start from a clean slate.
 */
export function __resetSnapshotForTests(): void {
  state.cache.clear();
  state.queue.length = 0;
  state.processing = false;
  if (state.reactRoot) {
    try {
      state.reactRoot.unmount();
    } catch {
      // Unmount errors are non-fatal in tests.
    }
  }
  if (state.containerEl?.parentElement) {
    state.containerEl.parentElement.removeChild(state.containerEl);
  }
  state.containerEl = null;
  state.reactRoot = null;
  renderImpl = null;
}

/**
 * Test-only: inject a stub renderer so unit tests can exercise the
 * queue + cache logic without spinning up react-dom or html-to-image.
 * Pass null to restore the real renderer on next call.
 */
export function __injectRendererForTests(
  fn: ((yaml: string) => Promise<string | null>) | null,
): void {
  renderImpl = fn;
  // Set placeholders so ensureContainer's idempotency check skips DOM work.
  if (fn !== null) {
    state.containerEl = state.containerEl ?? ({} as HTMLDivElement);
    state.reactRoot =
      state.reactRoot ??
      ({
        render: () => undefined,
        unmount: () => undefined,
      } as ReactRootLike);
  }
}
