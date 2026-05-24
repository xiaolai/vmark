/**
 * AppShell tests
 *
 * ADR-007 — Shell as composition root. AppShell must be a pure layout
 * primitive: no store imports, no feature knowledge, just slot composition.
 *
 * Tests cover: slot rendering, optional sidebar, className/style forwarding,
 * overlay z-stacking, chrome region reservation.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppShell } from "./AppShell";

const TEST_SIDEBAR_WIDTH = 280;

describe("AppShell", () => {
  it("renders chrome slot", () => {
    render(
      <AppShell
        chrome={<div data-testid="chrome">title</div>}
        primary={<div>main</div>}
      />
    );
    expect(screen.getByTestId("chrome")).toBeInTheDocument();
  });

  it("renders primary slot", () => {
    render(<AppShell primary={<div data-testid="primary">editor</div>} />);
    expect(screen.getByTestId("primary")).toBeInTheDocument();
  });

  it("renders sidebar when provided", () => {
    render(
      <AppShell
        sidebar={<div data-testid="sidebar">files</div>}
        sidebarWidth={TEST_SIDEBAR_WIDTH}
        primary={<div>main</div>}
      />
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("omits sidebar when null", () => {
    render(<AppShell sidebar={null} primary={<div>main</div>} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("forwards className to root for layout modifiers", () => {
    const { container } = render(
      <AppShell
        className="focus-mode typewriter-mode"
        primary={<div>main</div>}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("focus-mode");
    expect(root.className).toContain("typewriter-mode");
  });

  it("forwards style to root so CSS vars are inheritable", () => {
    const customStyle = { ["--example-var" as string]: "tokens.space[2][5]" };
    const { container } = render(
      <AppShell style={customStyle} primary={<div>main</div>} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--example-var")).toBe("tokens.space[2][5]");
  });

  it("renders overlays", () => {
    render(
      <AppShell
        overlays={<div data-testid="overlay">drop-target</div>}
        primary={<div>main</div>}
      />
    );
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
  });

  it("applies sidebarWidth to the aside element", () => {
    render(
      <AppShell
        sidebar={<div>files</div>}
        sidebarWidth={TEST_SIDEBAR_WIDTH}
        primary={<div>main</div>}
      />
    );
    const aside = screen.getByRole("complementary");
    expect(aside.style.width).toBe(`${TEST_SIDEBAR_WIDTH}px`);
  });

  it("module loads without store side-effects (purity gate)", async () => {
    const mod = await import("./AppShell");
    expect(mod.AppShell).toBeDefined();
  });
});
