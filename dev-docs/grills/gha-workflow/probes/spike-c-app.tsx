// Minimal ProseMirror harness with a custom NodeView that mounts
// @xyflow/react in static mode. Used to verify that disabling the full
// interaction prop matrix prevents event leakage between the canvas and
// ProseMirror.

import { schema as basicSchema } from "prosemirror-schema-basic";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { createRoot, type Root } from "react-dom/client";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node as RfNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

declare global {
  interface Window {
    __SPIKE_C__?: SpikeCState;
    __spikeCRebuild?: () => number;
  }
}

interface SpikeCState {
  ready: boolean;
  /** Number of NodeViews currently mounted (proxy for clean teardown). */
  liveNodeViews: number;
  /** Total NodeView instances created since page load. */
  totalCreated: number;
  /** Total NodeView instances destroyed since page load. */
  totalDestroyed: number;
  /** Doc cursor offset. */
  cursorOffset: number;
  /** Last logged event from the canvas (should remain empty). */
  canvasEvents: string[];
}

const state: SpikeCState = {
  ready: false,
  liveNodeViews: 0,
  totalCreated: 0,
  totalDestroyed: 0,
  cursorOffset: 0,
  canvasEvents: [],
};
window.__SPIKE_C__ = state;

const log = (msg: string) => {
  const el = document.getElementById("log") as HTMLTextAreaElement | null;
  if (el) el.value += msg + "\n";
};

// Schema — extend the basic schema with a workflow_fence block node.
const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({
    workflow_fence: {
      group: "block",
      content: "text*",
      atom: false,
      defining: true,
      code: true,
      toDOM: () => ["pre", { class: "workflow-fence-source" }, 0],
      parseDOM: [{ tag: "pre.workflow-fence-source" }],
    },
  }),
  marks: basicSchema.spec.marks,
});

const sampleNodes: RfNode[] = Array.from({ length: 6 }, (_, i) => ({
  id: `n${i}`,
  position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 110 },
  data: { label: `job-${i}` },
  style: {
    background: "var(--bg-color)",
    color: "var(--text-color)",
    border: "tokens.space.px solid var(--border-color)",
    borderRadius: 4,
    padding: 6,
    fontSize: 12,
  },
}));
const sampleEdges: Edge[] = sampleNodes.slice(1).map((n, i) => ({
  id: `e${i}`,
  source: `n${i}`,
  target: n.id,
}));

// Custom NodeView with full static-mode prop matrix per ADR-4.
class WorkflowFenceView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  private root: Root | null = null;

  constructor() {
    state.totalCreated++;
    state.liveNodeViews++;

    this.dom = document.createElement("div");
    this.dom.className = "workflow-fence";
    this.dom.setAttribute("data-spike-fence", "true");

    // Mount React inside a child so we don't conflict with PM's view.
    const reactHost = document.createElement("div");
    reactHost.style.height = "100%";
    this.dom.appendChild(reactHost);

    this.root = createRoot(reactHost);
    this.root.render(
      <ReactFlowProvider>
        <ReactFlow
          nodes={sampleNodes}
          edges={sampleEdges}
          fitView
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          tabIndex={-1}
          onNodeClick={() => state.canvasEvents.push("nodeClick")}
          onPaneClick={() => state.canvasEvents.push("paneClick")}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>,
    );
  }

  // No update() method: any node change forces destroy+recreate (worst case).
  // This is the lifecycle stress we want to test.

  ignoreMutation() {
    return true;
  }

  stopEvent() {
    return false;
  }

  destroy() {
    state.totalDestroyed++;
    state.liveNodeViews--;
    if (this.root) {
      // unmount synchronously to avoid React 19 act warnings under
      // playwright; queue microtask if necessary.
      try {
        this.root.unmount();
      } catch (e) {
        log(`unmount error: ${(e as Error).message}`);
      }
      this.root = null;
    }
  }
}

// Initial doc with a workflow_fence sandwiched between paragraphs.
function initialDoc() {
  const fenceContent = "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest";
  const docNode = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("Above the fence — selectable text."),
    ]),
    schema.node("workflow_fence", null, [schema.text(fenceContent)]),
    schema.node("paragraph", null, [
      schema.text("Below the fence — also selectable."),
    ]),
  ]);
  return docNode;
}

const editorEl = document.getElementById("editor")!;
const view = new EditorView(editorEl, {
  state: EditorState.create({
    doc: initialDoc(),
    schema,
    plugins: [keymap(baseKeymap)],
  }),
  nodeViews: {
    workflow_fence: () => new WorkflowFenceView(),
  },
  dispatchTransaction(tr) {
    const newState = view.state.apply(tr);
    view.updateState(newState);
    state.cursorOffset = newState.selection.from;
  },
});

// Helper: cause a NodeView rebuild by replacing the fence content.
window.__spikeCRebuild = () => {
  const tr = view.state.tr;
  // Walk doc, find the fence, replace its text.
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (node.type.name === "workflow_fence" && pos === -1) pos = p;
  });
  if (pos === -1) return -1;
  const node = view.state.doc.nodeAt(pos)!;
  const start = pos + 1;
  const end = pos + 1 + node.content.size;
  const newText = `name: ci\non: push\njobs:\n  build:\n    rev: ${Math.random().toString(36).slice(2, 6)}`;
  tr.replaceWith(start, end, schema.text(newText));
  view.dispatch(tr);
  return state.totalCreated;
};

state.ready = true;
log("editor ready, " + state.totalCreated + " fence views created");

// Set initial cursor at start.
view.dispatch(
  view.state.tr.setSelection(TextSelection.atStart(view.state.doc)),
);
state.cursorOffset = view.state.selection.from;

const status = document.getElementById("status");
if (status) status.textContent = "ready";
