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

  it("uses column layout when panel is top", () => {
    const { container } = render(
      <EditorArea editor={<div>editor</div>} bottomBar={<div>bottom</div>} panel={<div>panel</div>} panelPosition="top" />
    );
    expect(container.firstChild as HTMLElement).toHaveStyle({ flexDirection: "column" });
  });

  it("uses row layout when panel is left", () => {
    const { container } = render(
      <EditorArea editor={<div>editor</div>} bottomBar={<div>bottom</div>} panel={<div>panel</div>} panelPosition="left" />
    );
    expect(container.firstChild as HTMLElement).toHaveStyle({ flexDirection: "row" });
  });

  it.each(["top", "left"] as const)("renders the panel before the editor for %s", (panelPosition) => {
    const { container } = render(
      <EditorArea
        editor={<div data-testid="editor">editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div data-testid="panel">panel</div>}
        panelPosition={panelPosition}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.firstChild).toHaveAttribute("data-testid", "panel");
  });

  it.each(["bottom", "right"] as const)("renders the panel after the editor for %s", (panelPosition) => {
    const { container } = render(
      <EditorArea
        editor={<div data-testid="editor">editor</div>}
        bottomBar={<div>bottom</div>}
        panel={<div data-testid="panel">panel</div>}
        panelPosition={panelPosition}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.lastChild).toHaveAttribute("data-testid", "panel");
  });

  /**
   * The side dock is the in-flow home for full-height right-docked surfaces
   * (Knowledge Base today). It exists so such a panel DISPLACES the editor
   * instead of floating over it — a `position: fixed` overlay occludes the
   * document, which is what the KB panel did before.
   *
   * It is a separate slot from `panel` so it composes with the terminal at any
   * `panelPosition` rather than competing for the same slot.
   */
  describe("side dock", () => {
    it("leaves the DOM untouched when no side dock is provided", () => {
      const { container } = render(
        <EditorArea
          editor={<div data-testid="editor">editor</div>}
          bottomBar={<div>bottom</div>}
          panel={<div data-testid="panel">panel</div>}
          panelPosition="bottom"
        />
      );
      // No extra wrapper: the root is still the panel-axis container, so the
      // existing positioning contract above is unaffected.
      const root = container.firstChild as HTMLElement;
      expect(root.lastChild).toHaveAttribute("data-testid", "panel");
    });

    it("renders the side dock when provided", () => {
      render(
        <EditorArea
          editor={<div>editor</div>}
          bottomBar={<div>bottom</div>}
          panelPosition="bottom"
          sidePanel={<div data-testid="side-dock">kb</div>}
        />
      );
      expect(screen.getByTestId("side-dock")).toBeInTheDocument();
    });

    it("docks it to the right of the editor on a row axis", () => {
      const { container } = render(
        <EditorArea
          editor={<div data-testid="editor">editor</div>}
          bottomBar={<div>bottom</div>}
          panelPosition="bottom"
          sidePanel={<div data-testid="side-dock">kb</div>}
        />
      );
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveStyle({ flexDirection: "row" });
      expect(root.lastChild).toHaveAttribute("data-testid", "side-dock");
    });

    it("composes with a bottom panel — both are rendered", () => {
      render(
        <EditorArea
          editor={<div data-testid="editor">editor</div>}
          bottomBar={<div>bottom</div>}
          panel={<div data-testid="panel">terminal</div>}
          panelPosition="bottom"
          sidePanel={<div data-testid="side-dock">kb</div>}
        />
      );
      expect(screen.getByTestId("panel")).toBeInTheDocument();
      expect(screen.getByTestId("side-dock")).toBeInTheDocument();
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
  });
});
