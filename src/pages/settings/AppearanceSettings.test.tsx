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

describe("AppearanceSettings — follow system appearance (#1125)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        theme: "paper",
        followSystemAppearance: false,
        systemLightTheme: "paper",
        systemDarkTheme: "night",
      },
    });
  });

  it("renders the follow-system toggle, off by default", () => {
    render(<AppearanceSettings />);
    const toggle = screen.getByRole("switch", {
      name: /follow system appearance/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("shows a single theme row when not following the system", () => {
    render(<AppearanceSettings />);
    expect(screen.queryByText("Light theme")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark theme")).not.toBeInTheDocument();
    // One swatch per theme
    expect(screen.getAllByText("Paper")).toHaveLength(1);
  });

  it("enabling the toggle stores the flag and reveals light/dark rows", () => {
    render(<AppearanceSettings />);
    fireEvent.click(
      screen.getByRole("switch", { name: /follow system appearance/i })
    );
    expect(
      useSettingsStore.getState().appearance.followSystemAppearance
    ).toBe(true);
    expect(screen.getByText("Light theme")).toBeInTheDocument();
    expect(screen.getByText("Dark theme")).toBeInTheDocument();
    // Both rows render a full swatch set
    expect(screen.getAllByText("Paper")).toHaveLength(2);
  });

  it("swatch clicks in the light/dark rows update the paired themes", () => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        followSystemAppearance: true,
      },
    });
    render(<AppearanceSettings />);
    const [lightSepia, darkSepia] = screen.getAllByRole("button", {
      name: /sepia/i,
    });
    fireEvent.click(lightSepia);
    expect(useSettingsStore.getState().appearance.systemLightTheme).toBe(
      "sepia"
    );
    expect(useSettingsStore.getState().appearance.systemDarkTheme).toBe(
      "night"
    );
    fireEvent.click(darkSepia);
    expect(useSettingsStore.getState().appearance.systemDarkTheme).toBe(
      "sepia"
    );
    // Manual theme untouched by paired-row clicks
    expect(useSettingsStore.getState().appearance.theme).toBe("paper");
  });

  it("swatch clicks in manual mode keep updating appearance.theme", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: /night/i }));
    expect(useSettingsStore.getState().appearance.theme).toBe("night");
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
