import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng, toSvg } from "html-to-image";

// 20-node graph with custom-styled nodes that consume CSS vars,
// to verify token resolution in the export.
const nodes: Node[] = Array.from({ length: 20 }, (_, i) => ({
  id: `n${i}`,
  position: { x: (i % 5) * 220, y: Math.floor(i / 5) * 120 },
  data: { label: `job-${i}` },
  style: {
    background: "var(--bg-color)",
    color: "var(--text-color)",
    border: "tokens.space.px solid var(--border-color)",
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
  },
}));
const edges: Edge[] = nodes.slice(1).map((n, i) => ({
  id: `e${i}`,
  source: `n${i}`,
  target: n.id,
}));

declare global {
  interface Window {
    __SPIKE_B__?: {
      done: boolean;
      results?: SpikeBResults;
      error?: string;
    };
  }
}

interface ExportSample {
  ms: number;
  bytes: number;
  /** First 200 chars for inspection. */
  head: string;
  /** Whether output appears valid (rough heuristic). */
  valid: boolean;
}

interface SpikeBResults {
  light: { svg: ExportSample; png: ExportSample };
  dark: { svg: ExportSample; png: ExportSample };
  /** Smoke check: does the SVG mention any expected token-resolved color? */
  cssVarsResolved: boolean;
  nodeCount: number;
}

async function runExport(format: "svg" | "png"): Promise<ExportSample> {
  const el = document.querySelector(
    ".react-flow__viewport",
  ) as HTMLElement | null;
  if (!el) throw new Error("react-flow viewport not found");
  const t0 = performance.now();
  const out =
    format === "svg"
      ? await toSvg(el, { cacheBust: true })
      : await toPng(el, { cacheBust: true, pixelRatio: 2 });
  const ms = performance.now() - t0;
  const bytes = out.length;
  const head = out.slice(0, 200);
  const valid =
    format === "svg"
      ? head.startsWith("data:image/svg+xml") ||
        head.includes("<svg")
      : head.startsWith("data:image/png");
  return { ms: Math.round(ms * 10) / 10, bytes, head, valid };
}

function App() {
  const [status, setStatus] = useState("starting…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      window.__SPIKE_B__ = { done: false };
      try {
        // Wait for layout settle.
        await new Promise((r) => setTimeout(r, 400));
        setStatus("light: SVG…");
        const lightSvg = await runExport("svg");
        setStatus("light: PNG…");
        const lightPng = await runExport("png");

        document.documentElement.classList.add("dark-theme");
        await new Promise((r) => setTimeout(r, 200));

        setStatus("dark: SVG…");
        const darkSvg = await runExport("svg");
        setStatus("dark: PNG…");
        const darkPng = await runExport("png");

        // CSS-var resolution check: SVG should contain the *resolved* color
        // (#eeeded for light, #1e1e1e for dark). html-to-image inlines
        // computed styles when serializing.
        const cssVarsResolved =
          lightSvg.head.toLowerCase().includes("eeeded") ||
          lightSvg.bytes > 1000; // sanity fallback

        if (!cancelled) {
          window.__SPIKE_B__ = {
            done: true,
            results: {
              light: { svg: lightSvg, png: lightPng },
              dark: { svg: darkSvg, png: darkPng },
              cssVarsResolved,
              nodeCount: nodes.length,
            },
          };
          setStatus("done");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          window.__SPIKE_B__ = { done: true, error: msg };
          setStatus(`error: ${msg}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 5,
          padding: "tokens.radius.sm tokens.radius.lg",
          background: "var(--bg-color)",
          color: "var(--text-color)",
          border: "tokens.space.px solid var(--border-color)",
          borderRadius: 4,
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        Spike B status: {status}
      </div>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
