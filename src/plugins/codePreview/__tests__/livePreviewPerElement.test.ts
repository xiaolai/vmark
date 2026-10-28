// Audit F9 — live-preview debounce state must be keyed per preview element,
// not module-global: concurrent edit sessions (split panes rendering the same
// document, or two registered editors) must not cancel each other's pending
// renders.
//
// The live renderers run for REAL (KaTeX renders in jsdom); only Graphviz's
// WASM engine — a third-party boundary — is faked, answering with an SVG that
// names the DOT source it was asked to render.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@viz-js/viz", () => ({
  instance: () =>
    Promise.resolve({
      render: (dot: string) => ({
        status: "success",
        output: `<svg data-dot="${dot.replace(/"/g, "&quot;")}"></svg>`,
        errors: [],
      }),
    }),
}));

import { updateLivePreview } from "../editMode";
import { __resetSnapshotForTests } from "@/lib/ghaWorkflow/render/renderXyflowSnapshot";

/** The first real render lazy-loads KaTeX / the workflow renderer. */
const RENDER_WAIT = { timeout: 10_000 };
/** The off-screen root the workflow snapshot renderer mounts. */
const WORKFLOW_ROOT_ID = "vmark-workflow-snapshot-root";

/** The TeX source KaTeX embeds in its MathML annotation. */
function renderedTex(el: HTMLElement): string | null {
  return el.querySelector("annotation")?.textContent ?? null;
}

describe("updateLivePreview per-element debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Unmount the workflow root while any ResizeObserver stub is still in
    // place: React Flow must never run against jsdom's missing global.
    __resetSnapshotForTests();
    vi.unstubAllGlobals();
  });

  it("does not cancel element A's pending render when element B updates", () => {
    const elA = document.createElement("div");
    const elB = document.createElement("div");

    // Blank content renders the "empty" placeholder synchronously inside the
    // debounce callback — no async renderer involved.
    updateLivePreview(elA, "latex", "   ");
    updateLivePreview(elB, "latex", "   ");
    vi.runAllTimers();

    expect(elA.querySelector(".code-block-live-preview-empty")).not.toBeNull();
    expect(elB.querySelector(".code-block-live-preview-empty")).not.toBeNull();
  });

  it("still debounces rapid updates to the SAME element (only the last renders)", async () => {
    const el = document.createElement("div");

    updateLivePreview(el, "latex", "x^1");
    updateLivePreview(el, "latex", "x^2");
    vi.runAllTimers();

    await vi.waitFor(() => expect(renderedTex(el)).toBe("x^2"), RENDER_WAIT);
    expect(el.innerHTML).not.toContain("x^1");
  });

  it("routes yaml content to the workflow live renderer", async () => {
    // The workflow renderer draws through an off-screen React Flow root that
    // jsdom cannot lay out, so the render itself never completes here. What
    // routing is observable by is that root: only the workflow renderer
    // mounts it. jsdom lacks ResizeObserver, which React Flow constructs.
    let observers = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          observers += 1;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const el = document.createElement("div");
    expect(document.getElementById(WORKFLOW_ROOT_ID)).toBeNull();

    updateLivePreview(el, "yaml", "on: push\njobs:\n  build:\n    runs-on: x");
    vi.runAllTimers();

    await vi.waitFor(() => expect(document.getElementById(WORKFLOW_ROOT_ID)).not.toBeNull(), RENDER_WAIT);
    // The root's div is appended before React Flow mounts, and React's
    // scheduler, loaded under fake timers, defers that mount to whichever
    // test next advances them — after this stub is gone. Wait (waitFor
    // advances fake timers) until React Flow has mounted under the stub.
    await vi.waitFor(() => expect(observers).toBeGreaterThan(0), RENDER_WAIT);
  });

  it("does not route latex content to the workflow renderer", async () => {
    const el = document.createElement("div");
    updateLivePreview(el, "latex", "y^3");
    vi.runAllTimers();

    await vi.waitFor(() => expect(renderedTex(el)).toBe("y^3"), RENDER_WAIT);
    expect(document.getElementById(WORKFLOW_ROOT_ID)).toBeNull();
  });

  it.each(["dot", "graphviz"])("routes %s content to the graphviz live renderer", async (lang) => {
    const el = document.createElement("div");

    updateLivePreview(el, lang, "digraph { a -> b }");
    vi.runAllTimers();

    await vi.waitFor(() => expect(el.querySelector("svg")?.getAttribute("data-dot")).toBe("digraph { a -> b }"));
  });

  it("renders both elements when they debounce concurrently with real content", async () => {
    const elA = document.createElement("div");
    const elB = document.createElement("div");

    updateLivePreview(elA, "latex", "a^2");
    updateLivePreview(elB, "latex", "b^2");
    vi.runAllTimers();

    await vi.waitFor(() => {
      expect(renderedTex(elA)).toBe("a^2");
      expect(renderedTex(elB)).toBe("b^2");
    }, RENDER_WAIT);
  });
});
