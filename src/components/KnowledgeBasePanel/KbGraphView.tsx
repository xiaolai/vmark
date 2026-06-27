/**
 * KbGraphView (Phase 5; grill H5) — native interactive relationship graph using
 * `@xyflow/react`. Fetches the graph via the Rust-proxied command (no CORS),
 * lays it out with dagre, and renders docs/tags/relations. Distinct from the
 * served iframe view; toggled in the KB panel.
 *
 * @module components/KnowledgeBasePanel/KbGraphView
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getKbGraph } from "@/services/contentServer";
import { graphToFlow, type FlowGraph, type KbGraph } from "./graphToFlow";
import "./kb-graph.css";

export function KbGraphView() {
  const { t } = useTranslation();
  // Codex audit: subscribe to the workspace root so the graph refetches when
  // the workspace changes while the panel stays mounted.
  const root = useWorkspaceStore((s) => s.rootPath);
  const [flow, setFlow] = useState<FlowGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Legitimate setState-in-effect: resets to a loading state then fills from an
  // async graph fetch (with cancellation) — driven by I/O, not derivable during
  // render (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    setError(null);
    if (!root) {
      setError(t("contentServer.graph.noWorkspace"));
      return;
    }
    getKbGraph(root)
      .then((g) => {
        if (!cancelled) setFlow(graphToFlow(g as KbGraph));
      })
      .catch(() => {
        if (!cancelled) setError(t("contentServer.graph.error"));
      });
    return () => {
      cancelled = true;
    };
  }, [root, t]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (error) return <div className="kb-graph__error">{error}</div>;
  if (!flow) return <div className="kb-graph__loading" />;

  return (
    <div className="kb-graph" data-testid="kb-graph">
      <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
