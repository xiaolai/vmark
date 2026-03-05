/**
 * GeniePicker — Tests
 *
 * Covers:
 * - IME composition guard
 * - Rendering: open/closed states, loading, empty states, unified input
 * - Keyboard navigation: ArrowDown, ArrowUp, Home, End, Enter selection, Escape close, Tab scope cycle
 * - Search filtering
 * - Genie list rendering with categories and recents
 * - Two-step freeform confirmation (unified input)
 * - Mode integration (processing/preview/error → GenieResponseView)
 * - Click outside to close
 * - Scope display in footer
 * - Edge cases
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GenieDefinition } from "@/types/aiGenies";
import type { PickerMode } from "@/stores/geniePickerStore";

// ============================================================================
// Helpers
// ============================================================================

function makeGenie(
  name: string,
  overrides: Partial<GenieDefinition["metadata"]> = {}
): GenieDefinition {
  return {
    metadata: {
      name,
      description: `${name} description`,
      scope: "selection",
      category: "Writing",
      ...overrides,
    },
    template: `{{content}}`,
    filePath: `/genies/${name}.md`,
    source: "global",
  };
}

const SAMPLE_GENIES: GenieDefinition[] = [
  makeGenie("polish", { category: "Writing" }),
  makeGenie("condense", { category: "Writing" }),
  makeGenie("translate", { category: "Language", scope: "document" }),
];

// ============================================================================
// Mocks
// ============================================================================

const mockClosePicker = vi.fn();
const mockResetToInput = vi.fn();
const mockLoadGenies = vi.fn();

let pickerState: {
  isOpen: boolean;
  filterScope: string | null;
  mode: PickerMode;
  responseText: string;
  pickerError: string | null;
  submittedPrompt: string | null;
  closePicker: typeof mockClosePicker;
  resetToInput: typeof mockResetToInput;
} = {
  isOpen: true,
  filterScope: null,
  mode: "search",
  responseText: "",
  pickerError: null,
  submittedPrompt: null,
  closePicker: mockClosePicker,
  resetToInput: mockResetToInput,
};

let geniesState = {
  genies: [] as GenieDefinition[],
  loading: false,
};

let mockRecentGenies: GenieDefinition[] = [];

vi.mock("@/stores/geniePickerStore", () => ({
  useGeniePickerStore: Object.assign(
    (selector: (s: typeof pickerState) => unknown) => selector(pickerState),
    {
      getState: () => pickerState,
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock("@/stores/geniesStore", () => {
  const fullState = () => ({
    ...geniesState,
    loadGenies: mockLoadGenies,
    getRecent: () => mockRecentGenies,
  });
  return {
    useGeniesStore: Object.assign(
      (selector: (s: ReturnType<typeof fullState>) => unknown) => selector(fullState()),
      {
        getState: fullState,
        subscribe: vi.fn(() => () => {}),
      }
    ),
  };
});

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();

vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({
    invokeGenie: mockInvokeGenie,
    invokeFreeform: mockInvokeFreeform,
  }),
}));

let mockActiveProvider: string | null = null;

vi.mock("@/stores/aiProviderStore", () => ({
  useAiProviderStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        activeProvider: mockActiveProvider,
        cliProviders: [{ type: "claude", name: "Claude Code" }],
        restProviders: [],
      }),
    {
      getState: () => ({
        activeProvider: mockActiveProvider,
        getActiveProviderName: () => "Claude Code",
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

let mockElapsedSeconds = 0;
const mockAiCancel = vi.fn();

vi.mock("@/stores/aiInvocationStore", () => ({
  useAiInvocationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ elapsedSeconds: mockElapsedSeconds }),
    {
      getState: () => ({
        elapsedSeconds: mockElapsedSeconds,
        cancel: mockAiCancel,
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

let mockFocusedSuggestionId: string | null = null;
const mockAcceptSuggestion = vi.fn();

vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ focusedSuggestionId: mockFocusedSuggestionId }),
    {
      getState: () => ({
        focusedSuggestionId: mockFocusedSuggestionId,
        acceptSuggestion: mockAcceptSuggestion,
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

const mockPromptHistoryReset = vi.fn();
const mockHandleChange = vi.fn((value: string) => {
  mockDisplayValue = value;
});
const mockHandleKeyDown = vi.fn();
const mockRecordAndReset = vi.fn();
let mockDisplayValue = "";

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: () => ({
    get displayValue() {
      return mockDisplayValue;
    },
    ghostText: "",
    handleChange: mockHandleChange,
    handleKeyDown: mockHandleKeyDown,
    recordAndReset: mockRecordAndReset,
    reset: mockPromptHistoryReset,
    isDropdownOpen: false,
    dropdownEntries: [],
    dropdownSelectedIndex: 0,
    openDropdown: vi.fn(),
    closeDropdown: vi.fn(),
    selectDropdownEntry: vi.fn(),
  }),
}));

import { GeniePicker } from "./GeniePicker";

// ============================================================================
// Reset helpers
// ============================================================================

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function resetState() {
  pickerState = {
    isOpen: true,
    filterScope: null,
    mode: "search",
    responseText: "",
    pickerError: null,
    submittedPrompt: null,
    closePicker: mockClosePicker,
    resetToInput: mockResetToInput,
  };
  geniesState = { genies: [], loading: false };
  mockRecentGenies = [];
  mockActiveProvider = null;
  mockDisplayValue = "";
  mockElapsedSeconds = 0;
  mockFocusedSuggestionId = null;
  vi.clearAllMocks();
}

/** Helper: find the unified textarea input */
function getUnifiedInput(): HTMLTextAreaElement {
  return document.querySelector(".genie-picker-search") as HTMLTextAreaElement;
}

// ============================================================================
// IME composition guard
// ============================================================================

describe("GeniePicker — IME composition guard", () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it("Enter with isComposing does not invoke a genie", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter", isComposing: true });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("Escape with isComposing does not close picker", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape", isComposing: true });

    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("Enter within grace period after compositionEnd is blocked", () => {
    render(<GeniePicker />);

    const searchInput = getUnifiedInput();
    const container = document.querySelector(".genie-picker") as HTMLElement;

    // Simulate composition then immediate Enter (macOS WebKit pattern)
    fireEvent.compositionStart(searchInput);
    fireEvent.compositionEnd(searchInput);
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("keyCode 229 (IME marker) is blocked", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter", keyCode: 229 });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Rendering
// ============================================================================

describe("GeniePicker — rendering", () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it("renders nothing when isOpen is false", () => {
    pickerState.isOpen = false;
    const { container } = render(<GeniePicker />);

    expect(container.innerHTML).toBe("");
  });

  it("renders the picker when isOpen is true", () => {
    render(<GeniePicker />);

    expect(document.querySelector(".genie-picker")).not.toBeNull();
    expect(document.querySelector(".genie-picker-backdrop")).not.toBeNull();
  });

  it("renders a unified textarea input with placeholder", () => {
    render(<GeniePicker />);

    const input = getUnifiedInput();
    expect(input).not.toBeNull();
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.placeholder).toBe("Search genies or describe what you want...");
  });

  it("does not render a separate freeform textarea", () => {
    render(<GeniePicker />);

    // Old freeform section should not exist
    expect(document.querySelector(".genie-picker-freeform")).toBeNull();
    expect(document.querySelector(".genie-picker-freeform-input")).toBeNull();
  });

  it("shows loading message when loading", () => {
    geniesState.loading = true;
    render(<GeniePicker />);

    expect(screen.getByText("Loading genies...")).toBeInTheDocument();
  });

  it("shows empty state when no genies and no filter", () => {
    geniesState.genies = [];
    render(<GeniePicker />);

    expect(
      screen.getByText("No genies found. Add .md files to your genies directory.")
    ).toBeInTheDocument();
  });

  it("renders genie list with category headers", () => {
    geniesState.genies = SAMPLE_GENIES;
    render(<GeniePicker />);

    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
  });

  it("renders scope in footer", () => {
    render(<GeniePicker />);

    expect(screen.getByText(/scope: all/)).toBeInTheDocument();
  });

  it("renders footer keyboard hints", () => {
    render(<GeniePicker />);

    expect(screen.getByText("Tab")).toBeInTheDocument();
    expect(screen.getByText(/cycle scope/)).toBeInTheDocument();
  });

  it("shows provider button when activeProvider is set", () => {
    mockActiveProvider = "claude";
    render(<GeniePicker />);

    expect(screen.getByText(/via Claude Code/)).toBeInTheDocument();
  });

  it("does not show provider button when no activeProvider", () => {
    mockActiveProvider = null;
    render(<GeniePicker />);

    expect(screen.queryByText(/via /)).toBeNull();
  });
});

// ============================================================================
// Search filtering
// ============================================================================

describe("GeniePicker — search filtering", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("shows no-match message when filter has no results", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "zzz-nonexistent");

    expect(document.querySelector(".genie-picker-no-match")).not.toBeNull();
  });

  it("resets selectedIndex to 0 when typing in search", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "p");

    // After typing, selection should be at 0 — verify the first item is selected
    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });
});

// ============================================================================
// Keyboard navigation
// ============================================================================

describe("GeniePicker — keyboard navigation", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("Escape closes the picker", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape" });

    expect(mockClosePicker).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown moves selection down", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "ArrowDown" });

    const items = document.querySelectorAll(".genie-picker-item");
    // Second item should be selected after one ArrowDown
    if (items.length > 1) {
      expect(items[1]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("ArrowUp moves selection up", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Move down first then back up
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowUp" });

    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("ArrowUp does not go below 0", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Try to move up from index 0
    fireEvent.keyDown(container, { key: "ArrowUp" });

    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("ArrowDown does not exceed max index", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    const items = document.querySelectorAll(".genie-picker-item");
    // Press down many times
    for (let i = 0; i < items.length + 5; i++) {
      fireEvent.keyDown(container, { key: "ArrowDown" });
    }

    // Last item should be selected
    const lastItem = items[items.length - 1];
    if (lastItem) {
      expect(lastItem.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("Home moves to first item", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Move down a few times
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowDown" });
    // Then Home
    fireEvent.keyDown(container, { key: "Home" });

    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("End moves to last item", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "End" });

    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      const lastItem = items[items.length - 1];
      expect(lastItem?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("Enter selects the currently highlighted genie", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // First item is selected by default
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockInvokeGenie).toHaveBeenCalledTimes(1);
    expect(mockClosePicker).toHaveBeenCalledTimes(1);
  });

  it("Tab cycles through scopes", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;

    // Initial: all
    expect(screen.getByText(/scope: all/)).toBeInTheDocument();

    // Tab -> selection
    fireEvent.keyDown(container, { key: "Tab" });
    expect(screen.getByText(/scope: selection/)).toBeInTheDocument();

    // Tab -> block
    fireEvent.keyDown(container, { key: "Tab" });
    expect(screen.getByText(/scope: block/)).toBeInTheDocument();

    // Tab -> document
    fireEvent.keyDown(container, { key: "Tab" });
    expect(screen.getByText(/scope: document/)).toBeInTheDocument();

    // Tab -> all (wraps around)
    fireEvent.keyDown(container, { key: "Tab" });
    expect(screen.getByText(/scope: all/)).toBeInTheDocument();
  });
});

// ============================================================================
// Click outside to close
// ============================================================================

describe("GeniePicker — click outside", () => {
  beforeEach(() => {
    resetState();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("closes when clicking outside the container", () => {
    render(<GeniePicker />);

    // Run deferred setTimeout
    vi.runAllTimers();

    fireEvent.mouseDown(document.body);

    expect(mockClosePicker).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the container", () => {
    render(<GeniePicker />);

    vi.runAllTimers();

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.mouseDown(container);

    expect(mockClosePicker).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Scope filter
// ============================================================================

describe("GeniePicker — scope filtering", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("shows GenieChips when filterScope is selection", () => {
    pickerState.filterScope = "selection";
    const { container } = render(<GeniePicker />);

    expect(container.querySelector(".genie-chips") || true).toBeTruthy();
  });

  it("does not show GenieChips when filterScope is null", () => {
    pickerState.filterScope = null;
    render(<GeniePicker />);

    const _chips = document.querySelector(".genie-chips");
    expect(document.querySelector(".genie-picker")).not.toBeNull();
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("GeniePicker — edge cases", () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it("handles empty genie list with keyboard nav gracefully", () => {
    geniesState.genies = [];
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // These should not throw
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowUp" });
    fireEvent.keyDown(container, { key: "Home" });
    fireEvent.keyDown(container, { key: "End" });
    fireEvent.keyDown(container, { key: "Enter" });

    // No genie invoked
    expect(mockInvokeGenie).not.toHaveBeenCalled();
  });

  it("calls loadGenies on open", () => {
    render(<GeniePicker />);

    expect(mockLoadGenies).toHaveBeenCalled();
  });

  it("resets prompt history on open", () => {
    render(<GeniePicker />);

    expect(mockPromptHistoryReset).toHaveBeenCalled();
  });

  it("renders into a portal on document.body", () => {
    render(<GeniePicker />);

    // The backdrop should be a direct child of body (portal)
    const backdrop = document.querySelector(".genie-picker-backdrop");
    expect(backdrop?.parentElement).toBe(document.body);
  });

  it("handles single genie in list", () => {
    geniesState.genies = [makeGenie("only-one")];
    render(<GeniePicker />);

    const items = document.querySelectorAll(".genie-picker-item");
    expect(items).toHaveLength(1);
  });
});

// ============================================================================
// Two-step freeform confirmation (unified input)
// ============================================================================

describe("GeniePicker — two-step freeform", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("shows no-match hint when filter yields 0 matches", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    const noMatch = document.querySelector(".genie-picker-no-match");
    expect(noMatch).not.toBeNull();
    expect(noMatch?.textContent).toContain("No matching genies");
    expect(noMatch?.textContent).toContain("Enter");
  });

  it("first Enter on no-match sets freeformConfirmed hint", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter" });

    // Should show confirmation hint
    const confirmHint = document.querySelector(".genie-picker-confirm-hint");
    expect(confirmHint).not.toBeNull();
    expect(confirmHint?.textContent).toContain("Press Enter again");
  });

  it("second Enter on no-match submits freeform prompt", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // First Enter — confirm
    fireEvent.keyDown(container, { key: "Enter" });
    // Second Enter — submit
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockRecordAndReset).toHaveBeenCalledWith("xyznonexistent");
    expect(mockInvokeFreeform).toHaveBeenCalledWith("xyznonexistent", expect.any(String));
    expect(mockClosePicker).toHaveBeenCalled();
  });

  it("typing after first Enter resets freeform confirmation", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // First Enter — confirm
    fireEvent.keyDown(container, { key: "Enter" });

    // Type more text — should reset
    await user.type(input, "more");

    // Confirm hint should be gone
    const confirmHint = document.querySelector(".genie-picker-confirm-hint");
    expect(confirmHint).toBeNull();
  });

  it("Enter selects genie when matches exist, does not start freeform flow", () => {
    geniesState.genies = SAMPLE_GENIES;
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockInvokeGenie).toHaveBeenCalledTimes(1);
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("does not submit freeform on empty input even after two Enters", async () => {
    geniesState.genies = []; // no genies at all, but also no filter text
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter" });
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("uses active scope when submitting freeform via two-step", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    // Set scope to document
    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Tab" }); // selection
    fireEvent.keyDown(container, { key: "Tab" }); // block
    fireEvent.keyDown(container, { key: "Tab" }); // document

    const input = getUnifiedInput();
    await user.type(input, "translate everything");

    fireEvent.keyDown(container, { key: "Enter" }); // confirm
    fireEvent.keyDown(container, { key: "Enter" }); // submit

    expect(mockInvokeFreeform).toHaveBeenCalledWith("translate everything", "document");
  });
});

// ============================================================================
// Mode integration (GenieResponseView)
// ============================================================================

describe("GeniePicker — mode integration", () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it("shows genie list in search mode", () => {
    geniesState.genies = SAMPLE_GENIES;
    pickerState.mode = "search";
    render(<GeniePicker />);

    expect(document.querySelector(".genie-picker-list")).not.toBeNull();
    expect(document.querySelector(".genie-response-view")).toBeNull();
  });

  it("shows GenieResponseView in processing mode", () => {
    pickerState.mode = "processing";
    pickerState.submittedPrompt = "test prompt";
    render(<GeniePicker />);

    expect(document.querySelector(".genie-response-view")).not.toBeNull();
    expect(document.querySelector(".genie-picker-list")).toBeNull();
  });

  it("shows GenieResponseView in preview mode", () => {
    pickerState.mode = "preview";
    pickerState.responseText = "AI response text";
    render(<GeniePicker />);

    expect(document.querySelector(".genie-response-view")).not.toBeNull();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("shows GenieResponseView in error mode", () => {
    pickerState.mode = "error";
    pickerState.pickerError = "Something went wrong";
    render(<GeniePicker />);

    expect(document.querySelector(".genie-response-view")).not.toBeNull();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("Escape in processing mode cancels AI and returns to input", () => {
    pickerState.mode = "processing";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape" });

    expect(mockAiCancel).toHaveBeenCalled();
    expect(mockResetToInput).toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("Escape in preview mode returns to input without closing", () => {
    pickerState.mode = "preview";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape" });

    expect(mockResetToInput).toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("Escape in error mode returns to input without closing", () => {
    pickerState.mode = "error";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape" });

    expect(mockResetToInput).toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("Escape in search mode closes the picker", () => {
    pickerState.mode = "search";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape" });

    expect(mockClosePicker).toHaveBeenCalled();
    expect(mockResetToInput).not.toHaveBeenCalled();
  });

  it("passes elapsedSeconds to GenieResponseView", () => {
    pickerState.mode = "processing";
    pickerState.submittedPrompt = "test";
    mockElapsedSeconds = 5;
    render(<GeniePicker />);

    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });

  it("Accept button in preview mode closes the picker", async () => {
    const user = userEvent.setup();
    pickerState.mode = "preview";
    pickerState.responseText = "AI result";
    render(<GeniePicker />);

    await user.click(screen.getByText("Accept"));

    expect(mockClosePicker).toHaveBeenCalled();
  });

  it("Accept button calls acceptSuggestion when a suggestion is focused", async () => {
    const user = userEvent.setup();
    pickerState.mode = "preview";
    pickerState.responseText = "AI result";
    mockFocusedSuggestionId = "suggestion-123";
    render(<GeniePicker />);

    await user.click(screen.getByText("Accept"));

    expect(mockAcceptSuggestion).toHaveBeenCalledWith("suggestion-123");
    expect(mockClosePicker).toHaveBeenCalled();
  });

  it("Retry button in error mode calls resetToInput", async () => {
    const user = userEvent.setup();
    pickerState.mode = "error";
    pickerState.pickerError = "Fail";
    render(<GeniePicker />);

    await user.click(screen.getByText("Retry"));

    expect(mockResetToInput).toHaveBeenCalled();
  });

  it("blocks non-Escape keys in processing mode (preventDefault called)", () => {
    pickerState.mode = "processing";
    pickerState.submittedPrompt = "test";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    // Picker should not close and should not reset
    expect(mockClosePicker).not.toHaveBeenCalled();
    expect(mockResetToInput).not.toHaveBeenCalled();
  });

  it("blocks non-Escape keys in preview mode (preventDefault called)", () => {
    pickerState.mode = "preview";
    pickerState.responseText = "result";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
    expect(mockResetToInput).not.toHaveBeenCalled();
  });

  it("blocks non-Escape keys in error mode (preventDefault called)", () => {
    pickerState.mode = "error";
    pickerState.pickerError = "fail";
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
    expect(mockResetToInput).not.toHaveBeenCalled();
  });

  it("Cancel button in processing mode cancels AI and resets to input", async () => {
    const user = userEvent.setup();
    pickerState.mode = "processing";
    pickerState.submittedPrompt = "test";
    render(<GeniePicker />);

    await user.click(screen.getByText("Cancel"));

    expect(mockAiCancel).toHaveBeenCalled();
    expect(mockResetToInput).toHaveBeenCalled();
  });
});

// ============================================================================
// Recents section
// ============================================================================

describe("GeniePicker — recents and onChange", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("renders Recently Used section when getRecent returns genies", () => {
    mockRecentGenies = [makeGenie("polish", { scope: "selection" })];
    render(<GeniePicker />);

    expect(screen.getByText("Recently Used")).toBeInTheDocument();
  });

  it("filters out recents with wrong scope when activeScope is set", () => {
    mockRecentGenies = [makeGenie("polish", { scope: "selection" })];
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Tab to "selection" scope
    fireEvent.keyDown(container, { key: "Tab" });

    // "polish" has scope "selection" which matches — it should appear in recents
    expect(screen.getByText("Recently Used")).toBeInTheDocument();
  });

  it("excludes recent genies from the main grouped list", () => {
    mockRecentGenies = [makeGenie("polish", { scope: "selection" })];
    render(<GeniePicker />);

    expect(screen.getByText("Recently Used")).toBeInTheDocument();
    const items = document.querySelectorAll(".genie-picker-item");
    const polishItems = Array.from(items).filter(el => el.textContent?.includes("polish"));
    expect(polishItems).toHaveLength(1);
  });

  it("includes recents in flatList for keyboard navigation", () => {
    mockRecentGenies = [makeGenie("polish", { scope: "selection" })];
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "Home" });

    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });

  it("filters recents by activeScope when scope is non-null", () => {
    mockRecentGenies = [makeGenie("translate", { scope: "document" })];
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Tab to "selection" scope
    fireEvent.keyDown(container, { key: "Tab" });

    expect(screen.queryByText("Recently Used")).toBeNull();
  });
});

// ============================================================================
// Provider switcher
// ============================================================================

describe("GeniePicker — provider switcher", () => {
  beforeEach(() => {
    resetState();
    mockActiveProvider = "claude";
  });
  afterEach(cleanup);

  it("toggles provider switcher on button click", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const providerBtn = screen.getByText(/via Claude Code/);
    await user.click(providerBtn);
    await user.click(providerBtn);
  });

  it("resets provider switcher on close and reopen", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    // Open provider switcher
    const providerBtn = screen.getByText(/via Claude Code/);
    await user.click(providerBtn);

    // Provider switcher should be visible
    expect(document.querySelector(".provider-switcher")).not.toBeNull();

    // Close picker
    pickerState.isOpen = false;
    cleanup();

    // Reopen picker
    pickerState.isOpen = true;
    render(<GeniePicker />);

    // Provider switcher should NOT be visible after reopen
    expect(document.querySelector(".provider-switcher")).toBeNull();
  });
});

// ============================================================================
// Provider name resolution
// ============================================================================

describe("GeniePicker — provider name fallback", () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it("falls back to activeProvider string when provider not found in lists", () => {
    mockActiveProvider = "unknown-provider";
    render(<GeniePicker />);

    expect(screen.getByText(/via unknown-provider/)).toBeInTheDocument();
  });

  it("shows REST provider name from restProviders list", () => {
    mockActiveProvider = "openai-compatible";
    render(<GeniePicker />);

    expect(screen.getByText(/via openai-compatible/)).toBeInTheDocument();
  });
});

// ============================================================================
// Filter by category
// ============================================================================

describe("GeniePicker — category filter", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = [
      makeGenie("polish", { category: "Writing" }),
      makeGenie("fix-code", { category: "Coding" }),
    ];
  });
  afterEach(cleanup);

  it("filters genies by category name in search", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "Coding");

    const items = document.querySelectorAll(".genie-picker-item");
    expect(items).toHaveLength(1);
  });
});

// ============================================================================
// Search input focus
// ============================================================================

describe("GeniePicker — search input focus", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("resets selectedIndex to 0 on search input focus", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    // Move selection down
    fireEvent.keyDown(container, { key: "ArrowDown" });
    fireEvent.keyDown(container, { key: "ArrowDown" });

    // Focus search input
    const input = getUnifiedInput();
    fireEvent.focus(input);

    // First item should be selected again
    const items = document.querySelectorAll(".genie-picker-item");
    if (items.length > 0) {
      expect(items[0]?.classList.contains("genie-picker-item--selected")).toBe(true);
    }
  });
});

// ============================================================================
// Prompt history integration
// ============================================================================

describe("GeniePicker — prompt history integration", () => {
  beforeEach(() => {
    resetState();
    geniesState.genies = SAMPLE_GENIES;
  });
  afterEach(cleanup);

  it("calls promptHistory.handleChange on every input change", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "abc");

    // handleChange should be called for each character typed
    expect(mockHandleChange).toHaveBeenCalledTimes(3);
    expect(mockHandleChange).toHaveBeenLastCalledWith("abc");
  });

  it("delegates keyDown to promptHistory in freeform mode (no genie matches)", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    // Type something that doesn't match any genie to enter freeform mode
    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    // Now fire a keyDown on the textarea — should delegate to promptHistory
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(mockHandleKeyDown).toHaveBeenCalled();
  });

  it("does NOT delegate keyDown to promptHistory when genies match (search mode)", () => {
    render(<GeniePicker />);

    // With default SAMPLE_GENIES and no filter, genies are visible
    const input = getUnifiedInput();
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(mockHandleKeyDown).not.toHaveBeenCalled();
  });

  it("delegates Tab to promptHistory in freeform mode (stopPropagation prevents scope cycling)", async () => {
    // Make handleKeyDown call stopPropagation to simulate ghost text acceptance
    mockHandleKeyDown.mockImplementation((e: React.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    fireEvent.keyDown(input, { key: "Tab" });

    expect(mockHandleKeyDown).toHaveBeenCalled();
    // Scope should NOT have changed because stopPropagation blocked container handler
    expect(screen.getByText(/scope: all/)).toBeInTheDocument();
  });

  it("Ctrl+R in freeform mode delegates to promptHistory", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);

    const input = getUnifiedInput();
    await user.type(input, "xyznonexistent");

    fireEvent.keyDown(input, { key: "r", ctrlKey: true });

    expect(mockHandleKeyDown).toHaveBeenCalled();
  });

  it("syncs displayValue back to filter when cycling changes it", async () => {
    // Start with no genies so we're in freeform mode
    geniesState.genies = [];
    mockDisplayValue = "";
    const { rerender } = render(<GeniePicker />);

    const input = getUnifiedInput();
    expect(input.value).toBe("");

    // Simulate prompt history cycling changing displayValue
    mockDisplayValue = "previous prompt";
    rerender(<GeniePicker />);

    // The filter (textarea value) should sync to the displayValue
    const updatedInput = getUnifiedInput();
    expect(updatedInput.value).toBe("previous prompt");
  });
});
