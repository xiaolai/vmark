/**
 * Real-WebKit tier — the standalone `.mmd` pane's layout rules must not reach
 * Markdown's Mermaid widgets (#1200, #1215, #1505).
 *
 * Both surfaces carry `.mermaid-preview`. The `.mmd` adapter's stylesheet is
 * loaded eagerly with the format registry, so its bare `.mermaid-preview`
 * rules gave every Markdown `.code-block-preview.mermaid-preview` widget
 * `height: 100%` and its SVG `width: auto; max-height: 100%`. On the macOS 13
 * WebKit the reporters run, that SVG collapsed to 0 x 0 outside edit mode
 * (edit mode uses `.mermaid-live-preview`, which is why editing "fixed" it).
 *
 * Playwright's WebKit lays the leaked SVG out correctly, so geometry alone
 * cannot catch the SVG half of the leak there. The cases therefore assert
 * both: geometry (visible, inside the host, not stretched to a tall parent)
 * and the two SVG declarations that collapse on the old engine, read through
 * CSS Typed OM, which reports the computed `auto`/`100%` rather than pixels.
 *
 * It lives in codePreview, not mermaid: the widget classes it switches are
 * codePreview's, and codePreview is the hub licensed to import the mermaid
 * plugin. The last two cases pin that the standalone pane keeps its layout.
 */
import { afterEach, describe, expect, it } from "vitest";
import "@/styles/index.css";
import "@/plugins/codePreview/code-preview.css";
import "@/lib/formats/adapters/mermaid-preview.css";
import { renderMermaid } from "../mermaid/plugin";
import { setupMermaidPanZoom } from "../mermaid/mermaidPanZoom";
import { cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { sanitizeSvg } from "@/utils/sanitize";

const mounted: HTMLElement[] = [];
const frame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    cleanupDescendants(host);
    host.remove();
  }
});

function mount(markup: string, className: string) {
  const host = document.createElement("div");
  host.style.width = "640px";
  const preview = document.createElement("div");
  preview.className = className;
  preview.innerHTML = sanitizeSvg(markup);
  host.append(preview);
  document.body.append(host);
  mounted.push(host);
  return { host, preview, svg: preview.querySelector("svg")! };
}

function expectVisible(svg: SVGSVGElement, host: HTMLElement) {
  const bounds = svg.getBoundingClientRect();
  expect(bounds.width).toBeGreaterThan(20);
  expect(bounds.height).toBeGreaterThan(10);
  expect(bounds.width).toBeLessThanOrEqual(host.getBoundingClientRect().width);
}

describe("Mermaid preview sizing with both stylesheets loaded", () => {
  it.each([
    ["flowchart", "flowchart LR\n A[Task] --> B[Inspect] --> C[Decide] --> D[Test] --> E[Deliver]"],
    ["cycle", "flowchart LR\n A[Evidence] --> B[Decide] --> C[Test]\n C -->|Retry| A\n C -->|Pass| D[Deliver]"],
    ["sequence", "sequenceDiagram\n participant C as Client\n participant M as MCP\n participant T as API\n C->>M: Evidence\n M->>T: Questions\n T-->>M: Judgment\n M-->>C: Result"],
  ])("keeps %s visible when leaving edit mode and resizing", async (_name, source) => {
    const markup = await renderMermaid(source);
    expect(markup).not.toBeNull();
    const { host, preview, svg } = mount(markup!, "code-block-live-preview mermaid-live-preview");
    await frame();
    expectVisible(svg, host);

    preview.className = "code-block-preview mermaid-preview";
    await frame();
    expectVisible(svg, host);
    // Mermaid's width="100%" must survive; the standalone `width: auto` and
    // `max-height: 100%` are what collapse the SVG on the macOS 13 engine.
    expect(String(svg.computedStyleMap().get("width"))).toBe("100%");
    expect(getComputedStyle(svg).maxHeight).toBe("none");
    // A short inline diagram must not inherit the standalone pane's 100% height.
    host.style.height = "900px";
    expect(preview.getBoundingClientRect().height).toBeLessThan(900);

    setupMermaidPanZoom(preview);
    await frame();
    expectVisible(svg, host);
    host.style.width = "320px";
    await frame();
    expectVisible(svg, host);
  });

  it("still fills the standalone preview pane", async () => {
    const { host, preview, svg } = mount(
      '<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
      "mermaid-preview",
    );
    host.style.height = "400px";
    preview.style.boxSizing = "border-box";
    await frame();
    expect(preview.getBoundingClientRect().height).toBe(400);
    expectVisible(svg, host);
    expect(getComputedStyle(preview).contain).toBe("paint");
  });

  it("preserves standalone empty and invalid states", () => {
    const { preview } = mount("", "mermaid-preview mermaid-preview--empty");
    expect(getComputedStyle(preview).display).toBe("block");
    preview.className = "mermaid-preview mermaid-preview--invalid";
    expect(getComputedStyle(preview).alignItems).toBe("flex-start");
  });
});
