import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSettings } from "./AppearanceSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { FOCUS_DIM_OPACITY } from "@/hooks/useTheme";
import { selectableThemeIds } from "@/theme/themeAvailability";

// The swatch row only offers themes whose native chrome the platform can
// match (theme/themeAvailability.ts), so the platform is pinned rather than
// inherited from jsdom. Defaults to macOS — the full catalog — with the
// narrowed Windows/Linux picker covered in its own describe below.
// `usesOverlayTitleBar` is mocked alongside it rather than left to delegate:
// a module mock does not intercept the module's own internal calls, so the real
// implementation would read jsdom's `navigator.platform` and ignore this flag.
const platform = vi.hoisted(() => ({ isMac: true }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => platform.isMac,
  usesOverlayTitleBar: () => platform.isMac,
}));

beforeEach(() => {
  platform.isMac = true;
});

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
    // Each row offers only ITS mode (maintainer, 2026-09-02): the rows used
    // to both render all six, which read as an inexplicable duplicate.
    expect(screen.getAllByText("Paper")).toHaveLength(1);
    expect(screen.getAllByText("Night")).toHaveLength(1);
    expect(screen.getAllByText("Solarized")).toHaveLength(1);
    // A filtered row's mode badge would say the same thing six times — the
    // badges render only in the unfiltered manual row.
    expect(screen.queryByText("Light", { selector: "button span" })).not.toBeInTheDocument();
  });

  it("swatch clicks in the light/dark rows update the paired themes", () => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        followSystemAppearance: true,
      },
    });
    render(<AppearanceSettings />);
    // Sepia is a LIGHT theme, so it exists only in the light row now.
    fireEvent.click(screen.getByRole("button", { name: /sepia/i }));
    expect(useSettingsStore.getState().appearance.systemLightTheme).toBe(
      "sepia"
    );
    expect(useSettingsStore.getState().appearance.systemDarkTheme).toBe(
      "night"
    );
    fireEvent.click(screen.getByRole("button", { name: /solarized/i }));
    expect(useSettingsStore.getState().appearance.systemDarkTheme).toBe(
      "solarized"
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

// #1296 — the toggle only ever governed the app's own chrome strip, which is
// drawn on macOS alone. On Windows/Linux it offered to fill a redundant bar
// while the real title bar stayed blank, so the platform that cannot use it
// must not be offered it.
describe("AppearanceSettings — the titlebar filename toggle is macOS-only", () => {
  it("offers the toggle on macOS", () => {
    render(<AppearanceSettings />);
    expect(
      screen.getByRole("switch", { name: /show filename in titlebar/i })
    ).toBeInTheDocument();
  });

  it("hides the toggle off macOS", () => {
    platform.isMac = false;
    render(<AppearanceSettings />);
    expect(
      screen.queryByRole("switch", { name: /show filename in titlebar/i })
    ).toBeNull();
  });

  it("keeps the rest of the Window group off macOS", () => {
    // The gate must take one row, not the group around it.
    platform.isMac = false;
    render(<AppearanceSettings />);
    expect(
      screen.getByRole("switch", { name: /auto-?hide status bar/i })
    ).toBeInTheDocument();
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

describe("AppearanceSettings — theme picker narrowing (Windows/Linux)", () => {
  beforeEach(() => {
    platform.isMac = false;
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        followSystemAppearance: false,
        theme: "white",
      },
    });
  });

  it("offers only the two themes whose chrome the OS can match", () => {
    render(<AppearanceSettings />);
    expect(screen.getByRole("button", { name: /white/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /night/i })).toBeInTheDocument();
  });

  it("hides the themes that could never have matching chrome", () => {
    render(<AppearanceSettings />);
    for (const hidden of [/paper/i, /mint/i, /sepia/i, /solarized/i]) {
      expect(screen.queryByRole("button", { name: hidden })).toBeNull();
    }
  });

  it("still narrows both rows when following the system", () => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        followSystemAppearance: true,
      },
    });
    render(<AppearanceSettings />);
    // Mode filtering composes with platform narrowing: the light row offers
    // only white, the dark row only night — one swatch each, no cross-row
    // duplicates (2026-09-02).
    expect(screen.getAllByRole("button", { name: /white/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /night/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /sepia/i })).toBeNull();
  });

  it("selecting a narrowed theme still writes to the store", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: /night/i }));
    expect(useSettingsStore.getState().appearance.theme).toBe("night");
  });
});

// WI-UI1.6 — the selected swatch ring is token-backed; Tailwind palette
// classes (ring-gray-*) bypass the theme system and wore a fixed grey on
// every theme (plus a white offset halo on dark ones).
describe("AppearanceSettings — swatch ring uses tokens, not the Tailwind palette", () => {
  it("renders no palette colour class anywhere in the surface", () => {
    const { container } = render(<AppearanceSettings />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/ring-(?:gray|slate|zinc|neutral|stone)-\d/);
    expect(html).not.toMatch(/dark:ring-gray/);
  });
});

// WI-UI4.6 — the swatch is a MINI PAGE from the typed catalog, not a colour
// dot: an "Aa" specimen in the theme's ink on its paper, a description
// phrase, and a Light/Dark badge from isDark. A 1.00:1 fill (night swatch on
// a night page) no longer matters — the specimen carries the identity.
describe("theme swatches are mini pages (WI-UI4.6)", () => {
  it("renders one specimen tile + description per selectable theme, no palette class", () => {
    platform.isMac = true;
    render(<AppearanceSettings />);
    const tiles = document.querySelectorAll("[data-theme-swatch]");
    expect(tiles.length).toBe(selectableThemeIds(true).length);
    for (const tile of tiles) {
      expect(tile.querySelector("[data-swatch-specimen]")?.textContent).toBe("Aa");
      expect(tile.className).not.toMatch(/bg-\[#|palette/);
    }
    // description phrases come from the new keys (surfaced as the tooltip)
    expect(
      document.querySelector("[data-theme-swatch='paper']")?.closest("button")?.getAttribute("title"),
    ).toContain("Warm newsprint");
  });

  it("dark themes carry the Dark badge from the catalog's isDark", () => {
    platform.isMac = true;
    render(<AppearanceSettings />);
    const night = document.querySelector("[data-theme-swatch='night']")?.parentElement;
    expect(night?.textContent).toContain("Dark");
  });
});
