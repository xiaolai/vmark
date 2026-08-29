import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelComboBox } from "./ModelComboBox";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("ModelComboBox", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
    mockInvoke.mockClear();
  });

  it("renders input with current value", () => {
    render(
      <ModelComboBox
        provider="openai"
        value="gpt-4o"
        apiKey="sk-test"
        endpoint=""
        onChange={onChange}
      />,
    );

    expect(screen.getByPlaceholderText("Model")).toHaveValue("gpt-4o");
  });

  it("shows curated suggestions on focus (no auto-fetch for non-Ollama)", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey="sk-test"
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));

    // Should show curated suggestions without calling list_models
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls onChange when typing", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Model"), {
      target: { value: "custom-model" },
    });

    expect(onChange).toHaveBeenCalledWith("custom-model");
  });

  it("selects a suggestion on click", () => {
    render(
      <ModelComboBox
        provider="anthropic"
        value=""
        apiKey="sk-test"
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));

    const option = screen.getByText("claude-sonnet-4-5-20250929");
    fireEvent.mouseDown(option);

    expect(onChange).toHaveBeenCalledWith("claude-sonnet-4-5-20250929");
  });

  it("filters suggestions as user types", async () => {
    mockInvoke.mockResolvedValue([]);

    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mini" } });

    // After typing "mini", only models containing "mini" should remain
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      const texts = options.map((el) => el.textContent);
      expect(texts).toContain("gpt-4o-mini");
      expect(texts).toContain("gpt-4.1-mini");
      expect(texts).not.toContain("gpt-4o");
      expect(texts).not.toContain("gpt-4.1");
      expect(texts).not.toContain("gpt-4.1-nano");
    });
  });

  it("closes dropdown on Escape", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText("Model"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("fetches models from Ollama on open", async () => {
    mockInvoke.mockResolvedValue(["llama3.2", "codellama"]);

    render(
      <ModelComboBox
        provider="ollama-api"
        value=""
        apiKey=""
        endpoint="http://localhost:11434"
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));

    expect(mockInvoke).toHaveBeenCalledWith("list_models", {
      provider: "ollama-api",
      apiKey: null,
      endpoint: "http://localhost:11434",
    });

    await waitFor(() => {
      expect(screen.getByText("llama3.2")).toBeInTheDocument();
      expect(screen.getByText("codellama")).toBeInTheDocument();
    });
  });

  it("shows refresh button that re-fetches models", async () => {
    mockInvoke.mockResolvedValue(["model-a"]);

    render(
      <ModelComboBox
        provider="ollama-api"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const refreshBtn = screen.getByTitle("Refresh models");
    expect(refreshBtn).toBeInTheDocument();

    fireEvent.click(refreshBtn);

    expect(mockInvoke).toHaveBeenCalledWith("list_models", {
      provider: "ollama-api",
      apiKey: null,
      endpoint: null,
    });

    await waitFor(() => {
      expect(screen.getByText("model-a")).toBeInTheDocument();
    });
  });

  it("refresh merges curated + fetched for non-Ollama providers", async () => {
    mockInvoke.mockResolvedValue(["gpt-4o", "gpt-4o-2024-08-06", "gpt-4.1"]);

    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey="sk-test"
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle("Refresh models"));

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      const texts = options.map((el) => el.textContent);
      // Curated models appear first
      expect(texts[0]).toBe("gpt-4o");
      expect(texts[1]).toBe("gpt-4o-mini");
      // Fetched-only model appended (gpt-4o and gpt-4.1 are deduped)
      expect(texts).toContain("gpt-4o-2024-08-06");
    });
  });

  describe("IME composition guard", () => {
    it("Enter with isComposing does not select a model", () => {
      render(
        <ModelComboBox
          provider="openai"
          value=""
          apiKey=""
          endpoint=""
          onChange={onChange}
        />,
      );

      const input = screen.getByPlaceholderText("Model");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });

      // onChange should not have been called with a model selection
      // (it may be called from typing, but not from Enter selection)
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Escape with isComposing does not close dropdown", () => {
      render(
        <ModelComboBox
          provider="openai"
          value=""
          apiKey=""
          endpoint=""
          onChange={onChange}
        />,
      );

      const input = screen.getByPlaceholderText("Model");
      fireEvent.focus(input);
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.keyDown(input, { key: "Escape", isComposing: true });
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("Enter within grace period after compositionEnd is blocked", () => {
      render(
        <ModelComboBox
          provider="openai"
          value=""
          apiKey=""
          endpoint=""
          onChange={onChange}
        />,
      );

      const input = screen.getByPlaceholderText("Model");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });

      // Simulate composition then immediate Enter (macOS WebKit pattern)
      fireEvent.compositionStart(input);
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onChange).not.toHaveBeenCalled();
    });

    it("keyCode 229 (IME marker) is blocked", () => {
      render(
        <ModelComboBox
          provider="openai"
          value=""
          apiKey=""
          endpoint=""
          onChange={onChange}
        />,
      );

      const input = screen.getByPlaceholderText("Model");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("navigates with ArrowDown/ArrowUp and selects with Enter", () => {
    render(
      <ModelComboBox
        provider="anthropic"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);

    // ArrowDown selects first item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // ArrowDown again selects second item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Enter selects highlighted item
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
  });

  it("ArrowUp wraps to the last item from the first", () => {
    render(
      <ModelComboBox
        provider="anthropic"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);

    // ArrowDown to idx 0 (first), then ArrowUp wraps to idx 1 (last)
    fireEvent.keyDown(input, { key: "ArrowDown" }); // idx 0
    fireEvent.keyDown(input, { key: "ArrowUp" });   // wrap to idx 1 (last)
    fireEvent.keyDown(input, { key: "Enter" });

    // Anthropic: idx 0 -> ArrowUp wraps to last (idx 1)
    expect(onChange).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
  });

  it("ArrowDown wraps from last to first item", () => {
    render(
      <ModelComboBox
        provider="anthropic"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);

    // Move to first, second, then wrap around
    fireEvent.keyDown(input, { key: "ArrowDown" }); // idx 0
    fireEvent.keyDown(input, { key: "ArrowDown" }); // idx 1
    fireEvent.keyDown(input, { key: "ArrowDown" }); // wrap to idx 0
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("claude-sonnet-4-5-20250929");
  });

  it("Enter with no highlight closes dropdown", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Enter without moving highlight
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Should not have called onChange with a model selection
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles dropdown with chevron button", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const chevronBtn = screen.getByTitle("Show models");

    // Open
    fireEvent.click(chevronBtn);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Close
    fireEvent.click(chevronBtn);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens dropdown on ArrowUp when closed", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");

    // Ensure closed first
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // ArrowUp should also open it (line 122 branch)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("ArrowUp from highlightIdx 0 wraps to last item (line 136 branch)", () => {
    render(
      <ModelComboBox
        provider="anthropic"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);

    // ArrowDown to idx 0, then ArrowUp wraps to last
    fireEvent.keyDown(input, { key: "ArrowDown" }); // idx 0
    fireEvent.keyDown(input, { key: "ArrowUp" });   // wrap to last (idx = filtered.length - 1)
    fireEvent.keyDown(input, { key: "Enter" });

    // Anthropic has 2 curated models, so last is idx 1
    expect(onChange).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
  });

  it("opens dropdown on ArrowDown when closed", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");

    // Ensure closed first (blur to close if opened by focus)
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // ArrowDown should open it
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows 'No models found' when filter matches nothing", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz-nonexistent" } });

    expect(screen.getByText(/No models found\. Check the provider connection, then refresh\./)).toBeInTheDocument();
  });

  it("shows 'Loading models…' while fetching with no curated results", async () => {
    let resolveList: (v: string[]) => void;
    mockInvoke.mockImplementation(
      () => new Promise<string[]>((r) => { resolveList = r; }),
    );

    render(
      <ModelComboBox
        provider="ollama-api"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));

    expect(screen.getByText("Loading models…")).toBeInTheDocument();

    // Resolve to clean up
    resolveList!(["llama3"]);
    await waitFor(() => {
      expect(screen.getByText("llama3")).toBeInTheDocument();
    });
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <ModelComboBox
          provider="openai"
          value=""
          apiKey=""
          endpoint=""
          onChange={onChange}
        />
        <button data-testid="outside">Outside</button>
      </div>,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("highlights selected model in the list", () => {
    render(
      <ModelComboBox
        provider="openai"
        value="gpt-4o"
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Model"));

    const selectedOption = screen.getByRole("option", { name: "gpt-4o" });
    expect(selectedOption).toHaveAttribute("aria-selected", "true");
  });

  it("handles fetch failure gracefully (keeps curated list)", async () => {
    mockInvoke.mockRejectedValue(new Error("Network error"));

    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey="sk-test"
        endpoint=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle("Refresh models"));

    // Should still show curated models despite fetch failure
    await waitFor(() => {
      fireEvent.focus(screen.getByPlaceholderText("Model"));
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    });
  });

  it("updates highlightIdx on mouseEnter over a list item", () => {
    render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Model");
    fireEvent.focus(input);

    // Get a list option and trigger mouseEnter
    const options = screen.getAllByRole("option");
    fireEvent.mouseEnter(options[2]);

    // Now Enter should select the item the mouse entered
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2].textContent);
  });

  it("applies custom className", () => {
    const { container } = render(
      <ModelComboBox
        provider="openai"
        value=""
        apiKey=""
        endpoint=""
        onChange={onChange}
        className="flex-1"
      />,
    );

    expect(container.firstChild).toHaveClass("flex-1");
  });
});
