import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppTitleBar } from "./AppTitleBar";

const state = vi.hoisted(() => ({ active: false }));
vi.mock("./useBrowserWorkspaceState", () => ({
  useBrowserWorkspaceActive: () => state.active,
}));
vi.mock("@/components/TitleBar", () => ({
  TitleBar: ({ browserChrome }: { browserChrome?: React.ReactNode }) => (
    <div data-testid="titlebar">{browserChrome}</div>
  ),
}));
vi.mock("./BrowserChrome", () => ({
  BrowserChrome: ({ placement }: { placement?: string }) => (
    <div data-testid="chrome">{placement}</div>
  ),
}));

describe("AppTitleBar", () => {
  beforeEach(() => {
    state.active = false;
  });

  it("renders the title bar without chrome when the browser workspace is inactive", () => {
    render(<AppTitleBar />);
    expect(screen.getByTestId("titlebar")).toBeInTheDocument();
    expect(screen.queryByTestId("chrome")).not.toBeInTheDocument();
  });

  it("injects the titlebar browser chrome when the workspace is active", () => {
    state.active = true;
    render(<AppTitleBar />);
    expect(screen.getByTestId("chrome")).toHaveTextContent("titlebar");
  });
});
