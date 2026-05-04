/**
 * Purpose: React subtree backing renderXyflowSnapshot. Holds the
 *   `<ReactFlow/>` mount that captures workflow snapshots; the parent
 *   module (renderXyflowSnapshot) owns the persistent React root and
 *   the FIFO queue.
 *
 *   This file is split out so the parent `.ts` module stays free of
 *   JSX (and so React is only pulled in when a snapshot is actually
 *   requested — `renderXyflowSnapshot` dynamically imports this file).
 *
 * Pipeline per capture:
 *   yaml → parse → IR → toGraph → applyLayout → setNodes/setEdges
 *        → wait for layout → html-to-image.toSvg → cache hit
 *
 * @coordinates-with renderXyflowSnapshot.ts — owner of the React root + queue
 * @coordinates-with src/components/Editor/WorkflowPanel/JobNode.tsx — node visuals
 * @module lib/ghaWorkflow/render/snapshotRoot
 */

import { useEffect, useState, type ReactElement } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { JobNode } from "@/components/Editor/WorkflowPanel/JobNode";
import { parse } from "@/lib/ghaWorkflow/parser";
import { toGraph, type JobNodeData } from "./toGraph";
import { applyLayout } from "./layout";
import { diagramWarn } from "@/utils/debug";

const NODE_TYPES: NodeTypes = { job: JobNode };
const PRO_OPTIONS = { hideAttribution: true } as const;

interface RootRefShape {
  render: (node: unknown) => void;
  unmount: () => void;
}

interface CapturePayload {
  nodes: Node<JobNodeData>[];
  edges: Edge[];
  /** Resolves once the captured SVG (or null on failure) lands. */
  resolve: (svg: string | null) => void;
  /** Bumps every render so the inner component knows when to re-capture. */
  generation: number;
}

let attachedRoot: RootRefShape | null = null;
/** Pending capture; only one in flight at a time (FIFO is enforced upstream). */
let inFlight: CapturePayload | null = null;
/** Bumps each setPayload call so the component re-runs its capture effect. */
let generationCounter = 0;

interface SnapshotCanvasProps {
  payload: CapturePayload | null;
}

/**
 * Inner React component. Renders nothing visible when payload is null;
 * when payload arrives, mounts an off-screen ReactFlow with the
 * given nodes/edges and captures via html-to-image after a layout
 * frame. Resolves the payload's promise with the SVG (or null).
 */
function SnapshotCanvas({ payload }: SnapshotCanvasProps): ReactElement | null {
  const [readyKey, setReadyKey] = useState(0);

  useEffect(() => {
    if (!payload) return;
    setReadyKey((k) => k + 1);
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    // Two animation frames after the React render lets xyflow apply its
    // own internal layout pass before html-to-image walks the DOM.
    // 3 RAFs gives xyflow's effects (fitView, viewport transform)
    // time to settle before the capture. 2 frames was unreliable —
    // some frames the viewport transform was applied but per-node
    // transforms hadn't repainted yet.
    let raf2: number | null = null;
    let raf3: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          const reactFlowEl = document.querySelector(
            "#vmark-workflow-snapshot-root .react-flow",
          ) as HTMLElement | null;
          if (!reactFlowEl) {
            if (!cancelled) payload.resolve(null);
            return;
          }
          // Why toPng not toSvg: html-to-image's toSvg strips inline
          // `style` attributes (verified empirically — captured output
          // showed `style=""` on every node, collapsing all xyflow
          // viewport + per-node `transform: translate(...)` values).
          // toPng renders the live layout to a raster, preserving exact
          // visual positions. For a 3-9 job workflow the PNG is small;
          // for an inline read-only preview, raster is fine.
          toPng(reactFlowEl, {
            cacheBust: false,
            pixelRatio: 1,
            backgroundColor: "transparent",
          })
            .then((dataUrl) => {
              if (cancelled) return;
              // toPng returns `data:image/png;base64,...`. Wrap it as a
              // tiny inline SVG with an embedded <image> so the
              // existing .workflow-preview { svg } CSS sizing applies
              // unchanged. The SVG dimensions match the captured area.
              const wrapped = wrapPngAsSvg(dataUrl, reactFlowEl);
              payload.resolve(wrapped);
            })
            .catch((err: unknown) => {
              diagramWarn(
                "snapshotRoot toPng failed:",
                err instanceof Error ? err.message : String(err),
              );
              if (!cancelled) payload.resolve(null);
            });
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      if (raf3 !== null) cancelAnimationFrame(raf3);
    };
    // readyKey forces this effect to re-run for each new payload; payload
    // identity already encodes the generation counter.
  }, [payload, readyKey]);

  if (!payload) return null;

  return (
    <ReactFlowProvider>
      <ReactFlow<Node<JobNodeData>>
        nodes={payload.nodes}
        edges={payload.edges}
        nodeTypes={NODE_TYPES}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={PRO_OPTIONS}
        // Read-only: we're capturing a static frame.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
      />
    </ReactFlowProvider>
  );
}

/**
 * Wrap a PNG data URL inside an SVG so the existing
 * `.workflow-preview svg { max-width / max-height }` CSS rule applies
 * unchanged. The wrapper SVG sizes itself to the captured element's
 * client rect; the embedded image scales to fit.
 */
function wrapPngAsSvg(dataUrl: string, source: HTMLElement): string {
  const rect = source.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href="${dataUrl}" width="${w}" height="${h}"/>` +
    `</svg>`
  );
}

/**
 * Render a passive marker into the parent's React root so the
 * SnapshotCanvas component can re-render whenever a new payload
 * arrives. Internal state in this module pushes the next payload to
 * the canvas via React's prop comparison.
 */
function pushPayload(payload: CapturePayload | null): void {
  if (!attachedRoot) return;
  attachedRoot.render(<SnapshotCanvas payload={payload} />);
}

/**
 * Wire this module to a React root owned by `renderXyflowSnapshot`.
 * Idempotent across the session.
 */
export function attachTo(root: RootRefShape): void {
  attachedRoot = root;
  // Initial render with no payload so React reconciler is warm.
  pushPayload(null);
}

/**
 * Render a workflow YAML snapshot via the attached root. The actual
 * React render + html-to-image capture happens inside SnapshotCanvas;
 * this helper just packages the parsed graph and awaits the resolver.
 *
 * Returns null if (a) attachTo hasn't been called, (b) the YAML fails
 * to parse, (c) html-to-image can't capture the DOM.
 */
export async function captureSnapshot(yaml: string): Promise<string | null> {
  if (!attachedRoot) return null;

  let nodes: Node<JobNodeData>[];
  let edges: Edge[];
  try {
    const ir = parse(yaml);
    const graph = toGraph(ir);
    const laid = applyLayout(graph.nodes, graph.edges, { direction: "TD" });
    nodes = laid.nodes;
    edges = laid.edges;
  } catch (e) {
    diagramWarn(
      "snapshotRoot parse failed:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }

  // If the previous capture is still in-flight, abandon it (the queue
  // upstream already serialized; this is a defensive guard for races).
  if (inFlight) inFlight.resolve(null);

  return new Promise<string | null>((resolve) => {
    generationCounter += 1;
    inFlight = {
      nodes,
      edges,
      generation: generationCounter,
      resolve: (svg) => {
        inFlight = null;
        resolve(svg);
      },
    };
    pushPayload(inFlight);
  });
}
