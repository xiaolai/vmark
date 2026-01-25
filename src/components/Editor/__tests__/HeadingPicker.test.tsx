/**
 * HeadingPicker Tests
 *
 * Tests for the heading picker popup including:
 * - Portal rendering
 * - Filter input functionality
 * - Keyboard navigation (ArrowUp/Down, Enter, Escape)
 * - Click outside handling
 * - Mounting in editor-container
 * - Empty states
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock store
const mockClosePicker = vi.fn();
const mockSelectHeading = vi.fn();

let storeState = {
  isOpen: false,
  headings: [] as Array<{ id: string; text: string; level: number; pos: number }>,
  anchorRect: null as { top: number; bottom: number; left: number; right: number } | null,
  containerBounds: null as { horizontal: { left: number; right: number }; vertical: { top: number; bottom: number } } | null,
  closePicker: mockClosePicker,
  selectHeading: mockSelectHeading,
};

vi.mock("@/stores/headingPickerStore", () => ({
  useHeadingPickerStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    {
      getState: () => storeState,
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: () => ({ top: 200, left: 150 }),
  getViewportBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
}));

// Import after mocking
import { HeadingPicker } from "../HeadingPicker";

const mockHeadings = [
  { id: "introduction", text: "Introduction", level: 1, pos: 0 },
  { id: "getting-started", text: "Getting Started", level: 2, pos: 100 },
  { id: "installation", text: "Installation", level: 3, pos: 200 },
  { id: "configuration", text: "Configuration", level: 2, pos: 300 },
  { id: "advanced", text: "Advanced Features", level: 1, pos: 400 },
];

function resetState() {
  storeState = {
    isOpen: false,
    headings: [],
    anchorRect: null,
    containerBounds: null,
    closePicker: mockClosePicker,
    selectHeading: mockSelectHeading,
  };
}

function setState(newState: Partial<typeof storeState>) {
  storeState = { ...storeState, ...newState };
}

function createEditorContainer() {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.appendChild(container);
  return container;
}

describe("HeadingPicker", () => {
  let editorContainer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    editorContainer = createEditorContainer();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Mock scrollIntoView since jsdom doesn't implement it
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("Rendering", () => {
    it("does not render when closed", () => {
      setState({ isOpen: false });
      render(<HeadingPicker />);

      expect(screen.queryByPlaceholderText("Filter headings...")).toBeNull();
    });

    it("renders when open", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      expect(screen.getByPlaceholderText("Filter headings...")).not.toBeNull();
    });

    it("renders heading items when open with headings", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      expect(screen.getByText("Introduction")).not.toBeNull();
      expect(screen.getByText("Getting Started")).not.toBeNull();
      expect(screen.getByText("Installation")).not.toBeNull();
    });

    it("renders level indicators", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      // Use getAllByText since there are multiple H1 and H2 headings
      expect(screen.getAllByText("H1").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("H2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("H3").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Empty states", () => {
    it("shows empty message when no headings in document", async () => {
      setState({
        isOpen: true,
        headings: [],
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      expect(screen.getByText("No headings in document")).not.toBeNull();
    });

    it("shows filter empty message when filter matches nothing", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const input = screen.getByPlaceholderText("Filter headings...");
      fireEvent.change(input, { target: { value: "xyz123nonexistent" } });

      expect(screen.getByText("No headings match filter")).not.toBeNull();
    });
  });

  describe("Filtering", () => {
    it("filters headings by text", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const input = screen.getByPlaceholderText("Filter headings...");
      fireEvent.change(input, { target: { value: "install" } });

      expect(screen.getByText("Installation")).not.toBeNull();
      expect(screen.queryByText("Introduction")).toBeNull();
    });

    it("filters headings by id", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const input = screen.getByPlaceholderText("Filter headings...");
      fireEvent.change(input, { target: { value: "getting-started" } });

      expect(screen.getByText("Getting Started")).not.toBeNull();
      expect(screen.queryByText("Introduction")).toBeNull();
    });

    it("filter is case-insensitive", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const input = screen.getByPlaceholderText("Filter headings...");
      fireEvent.change(input, { target: { value: "ADVANCED" } });

      expect(screen.getByText("Advanced Features")).not.toBeNull();
    });
  });

  describe("Keyboard navigation", () => {
    it("ArrowDown moves selection down", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      fireEvent.keyDown(container, { key: "ArrowDown" });

      const items = document.querySelectorAll(".heading-picker-item");
      expect(items[1].classList.contains("selected")).toBe(true);
    });

    it("ArrowUp moves selection up", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      // Move down first
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "ArrowDown" });
      // Then up
      fireEvent.keyDown(container, { key: "ArrowUp" });

      const items = document.querySelectorAll(".heading-picker-item");
      expect(items[1].classList.contains("selected")).toBe(true);
    });

    it("ArrowDown stops at last item", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      // Move down many times
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(container, { key: "ArrowDown" });
      }

      const items = document.querySelectorAll(".heading-picker-item");
      expect(items[items.length - 1].classList.contains("selected")).toBe(true);
    });

    it("ArrowUp stops at first item", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      fireEvent.keyDown(container, { key: "ArrowUp" });

      const items = document.querySelectorAll(".heading-picker-item");
      expect(items[0].classList.contains("selected")).toBe(true);
    });

    it("Enter selects current heading", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      fireEvent.keyDown(container, { key: "Enter" });

      expect(mockSelectHeading).toHaveBeenCalledWith(mockHeadings[0]);
    });

    it("Enter selects navigated heading", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "Enter" });

      expect(mockSelectHeading).toHaveBeenCalledWith(mockHeadings[2]);
    });

    it("Escape closes picker", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      fireEvent.keyDown(container, { key: "Escape" });

      expect(mockClosePicker).toHaveBeenCalled();
    });
  });

  describe("Mouse interaction", () => {
    it("clicking heading item selects it", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const item = screen.getByText("Configuration").closest("button");
      fireEvent.click(item!);

      expect(mockSelectHeading).toHaveBeenCalledWith(mockHeadings[3]);
    });
  });

  describe("Click outside", () => {
    it("closes when clicking outside", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      // Let the timeout pass that registers the click outside handler
      await vi.advanceTimersByTimeAsync(10);

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePicker).toHaveBeenCalled();
    });

    it("does not close when clicking inside", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      // Let the timeout pass
      await vi.advanceTimersByTimeAsync(10);

      const container = document.querySelector(".heading-picker") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: container });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePicker).not.toHaveBeenCalled();
    });
  });

  describe("Portal mounting", () => {
    it("mounts inside editor-container when available", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const picker = document.querySelector(".heading-picker");
      expect(editorContainer.contains(picker)).toBe(true);
    });

    it("uses absolute positioning when in editor container", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const picker = document.querySelector(".heading-picker") as HTMLElement;
      expect(picker.style.position).toBe("absolute");
    });
  });

  describe("Selection clamping", () => {
    it("clamps selection when filter reduces list", async () => {
      setState({
        isOpen: true,
        headings: mockHeadings,
        anchorRect: { top: 100, bottom: 120, left: 50, right: 150 },
      });

      render(<HeadingPicker />);
      await vi.runAllTimersAsync();

      const container = document.querySelector(".heading-picker") as HTMLElement;
      // Navigate to item 4 (last)
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "ArrowDown" });
      fireEvent.keyDown(container, { key: "ArrowDown" });

      // Filter to only 1 result
      const input = screen.getByPlaceholderText("Filter headings...");
      fireEvent.change(input, { target: { value: "installation" } });

      // Selection should clamp to 0 (only item)
      const items = document.querySelectorAll(".heading-picker-item");
      expect(items.length).toBe(1);
      expect(items[0].classList.contains("selected")).toBe(true);
    });
  });
});
