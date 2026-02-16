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
});
