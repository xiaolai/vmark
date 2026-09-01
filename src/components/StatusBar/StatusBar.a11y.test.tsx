// WI-UI4.5 — axe coverage for the status bar's stateful chrome (MCP state,
// mode/terminal/lock toggles). `focus-order-semantics` is enabled;
// `color-contrast` stays DISABLED because jsdom computes no layout, so the
// rule is unreliable here (the house-standard reason, AppShell.a11y) — real
// contrast is measured from the theme catalog by `pnpm lint:theme-contrast`,
// a stronger check than axe-in-jsdom could ever be.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@/test/axeMatchers";
import { axe } from "vitest-axe";

vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: () => vi.fn()(),
}));

vi.mock("@/services/terminal/terminalGate", () => ({
  requestToggleTerminal: () => vi.fn()(),
}));

vi.mock("@/utils/dateUtils", () => ({
  formatExactTime: (ts: number) => `time:${ts}`,
}));

vi.mock("./StatusBarCounts", () => ({
  StatusBarCounts: () => <span data-testid="status-counts" />,
}));

vi.mock("./LintBadge", () => ({
  LintBadge: () => null,
}));



import { StatusBarRight, formatMcpTooltip } from "./StatusBarRight";

const AXE_OPTS = {
  rules: {
    "color-contrast": { enabled: false },
    "focus-order-semantics": { enabled: true },
  },
};

const baseProps = {
  aiRunning: false,
  elapsedSeconds: 0,
  aiError: null as string | null,
  showSuccess: false,
  onCancelAi: vi.fn(),
  onRetryAi: vi.fn(),
  onDismissError: vi.fn(),
  mcpRunning: true,
  mcpLoading: false,
  mcpError: null,
  mcpClients: [],
  openMcpSettings: vi.fn(),
  showAutoSavePaused: false,
  isDivergent: false,
  showAutoSave: false,
  lastAutoSave: null,
  autoSaveTime: "",
  terminalVisible: false,
  terminalShortcut: "Mod-`",
  saveShortcut: "Mod-s",
  sourceMode: false,
  sourceModeShortcut: "Mod-/",
  onToggleSourceMode: vi.fn(),
  readOnly: false,
  readOnlyShortcut: "F10",
  onToggleReadOnly: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe("StatusBar a11y (WI-UI4.5)", () => {
  it("the right-side controls (MCP state included) pass axe", async () => {
    const { container } = render(<StatusBarRight {...baseProps} />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it("the MCP button's accessible name carries the STATE, not just a label", () => {
    // Assert the exact formatMcpTooltip value per state — "aria-label is
    // nonempty and equals title" would stay green if both became a static
    // "MCP" (audit round 2, finding 48).
    const states = [
      { props: {}, expected: formatMcpTooltip(true, false, null, []) },
      { props: { mcpRunning: false }, expected: formatMcpTooltip(false, false, null, []) },
      { props: { mcpLoading: true }, expected: formatMcpTooltip(true, true, null, []) },
      { props: { mcpError: "boom" }, expected: formatMcpTooltip(true, false, "boom", []) },
    ];
    const seen = new Set<string>();
    for (const { props, expected } of states) {
      const { container, unmount } = render(<StatusBarRight {...baseProps} {...props} />);
      const mcp = container.querySelector(".status-mcp");
      expect(mcp?.getAttribute("aria-label")).toBe(expected);
      expect(mcp?.getAttribute("aria-label")).toBe(mcp?.getAttribute("title"));
      // Connected renders no state word (its badge speaks); when the word
      // exists it must stay aria-hidden — the NAME carries the state.
      const stateWord = mcp?.querySelector(".status-mcp__state");
      if (stateWord) expect(stateWord.getAttribute("aria-hidden")).toBe("true");
      seen.add(expected);
      unmount();
    }
    // The four states produce four DISTINCT names — the state is really in there.
    expect(seen.size).toBe(4);
  });
});
