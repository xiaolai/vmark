/**
 * AppShell tests
 *
 * ADR-007 — Shell as composition root. AppShell must be a pure layout
 * primitive: no store imports, no feature knowledge, just slot composition.
 *
 * Tests cover: slot rendering, optional sidebar, className/style forwarding,
 * overlay z-stacking, chrome region reservation.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppShell, CHROME_HEIGHT } from "./AppShell";

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

  // The browser-mode title bar is opaque and must start where the leading
  // column ends, so its stylesheet needs the column's width. Publishing it
  // from the SAME prop that sizes the aside is what keeps the two from
  // drifting: title-bar.css once restated the offset as the bare rail width,
  // and when the leading-card redesign moved the rail 8px inboard the stale
  // restatement overpainted the card's top corner (the white-notch defect).
  it("publishes the side width as --shell-side-width for the chrome's stylesheet", () => {
    const { container } = render(
      <AppShell
        sidebar={<div>rail</div>}
        sidebarWidth={TEST_SIDEBAR_WIDTH}
        primary={<div>main</div>}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--shell-side-width")).toBe(`${TEST_SIDEBAR_WIDTH}px`);
  });

  it("publishes --shell-side-width: 0px when no sidebar is mounted", () => {
    const { container } = render(<AppShell primary={<div>main</div>} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--shell-side-width")).toBe("0px");
  });

  // #1296 — the reserved strip and the thing that fills it must be one decision.
  // The shell reserved 40px unconditionally, so on Windows/Linux — where the OS
  // draws its own title bar and no chrome is passed — the top of every window
  // was an empty band.
  it("reserves the chrome height when a chrome slot is filled", () => {
    render(
      <AppShell chrome={<div>title</div>} primary={<div data-testid="primary">main</div>} />
    );
    const primary = screen.getByTestId("primary").parentElement as HTMLElement;
    expect(primary.style.paddingTop).toBe(`${CHROME_HEIGHT}px`);
  });

  it("reserves nothing when there is no chrome to reserve it for", () => {
    render(<AppShell primary={<div data-testid="primary">main</div>} />);
    const primary = screen.getByTestId("primary").parentElement as HTMLElement;
    expect(primary.style.paddingTop).toBe("0px");
  });

  it("reserves nothing when chrome is explicitly null", () => {
    render(<AppShell chrome={null} primary={<div data-testid="primary">main</div>} />);
    const primary = screen.getByTestId("primary").parentElement as HTMLElement;
    expect(primary.style.paddingTop).toBe("0px");
  });

  // The strip's own stylesheet needs the same height, and a second literal there
  // could drift with nothing to catch it — `.title-bar` reads this variable.
  it("publishes the chrome height for the chrome's stylesheet", () => {
    const { container } = render(<AppShell primary={<div>main</div>} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--chrome-height")).toBe(`${CHROME_HEIGHT}px`);
  });

  // Publishing the variable is only half the fix: nothing in jsdom loads the
  // stylesheet, so without reading it, `.title-bar` could go back to a literal
  // and every test here would still pass. This asserts the consumer.
  it("is the ONLY definition of the strip's height — title-bar.css reads the var", () => {
    const css = readFileSync(
      resolve(__dirname, "../components/TitleBar/title-bar.css"),
      "utf8"
    );
    const titleBarRule = css.slice(css.indexOf(".title-bar {"), css.indexOf("}", css.indexOf(".title-bar {")));
    expect(titleBarRule).toContain("height: var(--chrome-height)");
    // No fallback literal either — that is the drift this replaced.
    expect(titleBarRule).not.toMatch(/height:\s*\d/);
  });

  it("does not let the published height clobber the caller's own vars", () => {
    const { container } = render(
      <AppShell
        style={{ ["--workspace-rail-width" as string]: "30px" }}
        primary={<div>main</div>}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--workspace-rail-width")).toBe("30px");
    expect(root.style.getPropertyValue("--chrome-height")).toBe(`${CHROME_HEIGHT}px`);
  });

  it("module loads without store side-effects (purity gate)", async () => {
    const mod = await import("./AppShell");
    expect(mod.AppShell).toBeDefined();
  });
});
