/**
 * EditorArea tests
 *
 * ADR-007 — EditorArea is the pure layout helper that composes editor +
 * bottom bar + panel with dynamic positioning. Mode-aware behavior is
 * confined to the panelPosition prop; no store imports.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EditorArea } from "./EditorArea";

describe("EditorArea", () => {
  it("renders editor slot", () => {
    render(
      <EditorArea
        editor={<div data-testid="editor">editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div>panel</div>}
        panelPosition="bottom"
      />
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("renders bottomBar slot", () => {
    render(
      <EditorArea
        editor={<div>editor</div>}
        bottomBar={<div data-testid="bottom-bar">bottom</div>}
        panel={<div>panel</div>}
        panelPosition="bottom"
      />
    );
    expect(screen.getByTestId("bottom-bar")).toBeInTheDocument();
  });

  it("renders panel slot when provided", () => {
    render(
      <EditorArea
        editor={<div>editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div data-testid="panel">terminal</div>}
        panelPosition="bottom"
      />
    );
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });

  it("uses column layout when panel is bottom", () => {
    const { container } = render(
      <EditorArea
        editor={<div>editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div>panel</div>}
        panelPosition="bottom"
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveStyle({ flexDirection: "column" });
  });

  it("uses row layout when panel is right", () => {
    const { container } = render(
      <EditorArea
        editor={<div>editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div>panel</div>}
        panelPosition="right"
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveStyle({ flexDirection: "row" });
  });

  it("renders without panel when omitted", () => {
    render(
      <EditorArea
        editor={<div data-testid="editor">editor</div>}
        bottomBar={<div>bottom</div>}
        panelPosition="bottom"
      />
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });
});
