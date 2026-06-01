import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSettings } from "./AppearanceSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { FOCUS_DIM_OPACITY } from "@/hooks/useTheme";

describe("AppearanceSettings — focus mode dim (WI-10)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      appearance: { ...useSettingsStore.getState().appearance, focusModeDim: "standard" },
    });
  });

  it("renders the focus mode dim control", () => {
    render(<AppearanceSettings />);
    expect(screen.getByText("Dim level")).toBeInTheDocument();
  });

  it("reflects the stored value", () => {
    render(<AppearanceSettings />);
    expect(screen.getByDisplayValue("Standard")).toBeInTheDocument();
  });

  it("changing the select updates the store", () => {
    render(<AppearanceSettings />);
    fireEvent.change(screen.getByDisplayValue("Standard"), {
      target: { value: "stronger" },
    });
    expect(useSettingsStore.getState().appearance.focusModeDim).toBe("stronger");
  });

  it("exercises theme buttons, toggles, and selects without throwing", () => {
    render(<AppearanceSettings />);
    expect(() => {
      screen.getAllByRole("button").forEach((b) => fireEvent.click(b));
      screen.getAllByRole("switch").forEach((s) => fireEvent.click(s));
      document.querySelectorAll("select").forEach((sel) => {
        const opts = sel.querySelectorAll("option");
        if (opts.length) {
          fireEvent.change(sel, { target: { value: opts[opts.length - 1].value } });
        }
      });
    }).not.toThrow();
  });
});

describe("FOCUS_DIM_OPACITY map", () => {
  it("keeps the standard level at full opacity (current behavior)", () => {
    expect(FOCUS_DIM_OPACITY.standard).toBe("1");
  });
  it("dims progressively for stronger levels", () => {
    expect(Number(FOCUS_DIM_OPACITY.strong)).toBeLessThan(1);
    expect(Number(FOCUS_DIM_OPACITY.stronger)).toBeLessThan(Number(FOCUS_DIM_OPACITY.strong));
  });
});
