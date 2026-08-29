// WI-UI4.5 — axe coverage for the command palette on the shared overlay
// shell: listbox semantics, the aria-activedescendant wiring and the footer.
// `focus-order-semantics` is enabled; `color-contrast` stays DISABLED — jsdom
// computes no layout, so the rule is unreliable here (house-standard reason;
// real contrast is measured by `pnpm lint:theme-contrast` from the catalog).
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@/test/axeMatchers";
import { axe } from "vitest-axe";
import type { RankedCommand } from "@/services/commands";

const mockRanked: RankedCommand[] = [];
const mockExecuteCommand = vi.fn(async () => {});
const mockSearchCommands = vi.fn(() => mockRanked);

vi.mock("@/services/commands", () => ({
  executeCommand: (...args: unknown[]) => (mockExecuteCommand as (...a: unknown[]) => unknown)(...args),
  searchCommands: (...args: unknown[]) => (mockSearchCommands as (...a: unknown[]) => unknown)(...args),
  resolveLocalizedString: (v: unknown) =>
    typeof v === "function" ? (v as () => string)() : String(v),
}));
vi.mock("@/services/commands/commandContext", () => ({
  resolveCommandContext: (windowLabel: string) => ({ windowLabel, mode: "wysiwyg", isDocument: true }),
}));
vi.mock("@/utils/imeGuard", () => ({ isImeKeyEvent: vi.fn(() => false) }));
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandPaletteStore } from "@/stores/commandPaletteStore";

const AXE_OPTS = {
  rules: {
    "color-contrast": { enabled: false },
    "focus-order-semantics": { enabled: true },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRanked.length = 0;
  mockRanked.push(
    { command: { id: "a", title: "Alpha", run: vi.fn() }, score: 1 },
    { command: { id: "b", title: "Beta", run: vi.fn() }, score: 1 },
  );
  useCommandPaletteStore.setState({ isOpen: true });
});

describe("CommandPalette a11y (WI-UI4.5)", () => {
  it("the open palette passes axe", async () => {
    const { container } = render(<CommandPalette />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
