/**
 * #1429 — a font the user installed but VMark's curated list does not name
 * (LXGW WenKai / 霞鹜文楷 in the report) was unreachable. The picker now also
 * carries every installed family and accepts a typed family name.
 *
 * Real settings store, reset per test. `useSystemFontFamilies` is mocked
 * because the families come from a Tauri command; everything else is real, so
 * these assertions are about what the user sees and what gets stored.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockInstalled = vi.fn<() => string[]>(() => []);
vi.mock("@/hooks/useSystemFontFamilies", () => ({
  useSystemFontFamilies: () => mockInstalled(),
}));

import { FontSettings } from "./FontSettings";
import { useSettingsStore } from "@/stores/settingsStore";

const store = () => useSettingsStore.getState();
const LATIN = /^latin font$/i;
const CJK = /^cjk font$/i;
// The custom-family field carries a `<datalist>`, so its accessible role is
// combobox rather than textbox — see FontSettingRow's note on why that is
// unconditional.
const CUSTOM_FAMILY = /^custom font family$/i;

const latinSelect = () => screen.getByRole("combobox", { name: LATIN });

beforeEach(() => {
  store().resetSettings();
  mockInstalled.mockReturnValue([]);
});

describe("FontSettings — curated shortlist", () => {
  it("still offers the curated families", () => {
    render(<FontSettings />);
    expect(screen.getByRole("option", { name: "Athelas" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Songti SC" })).toBeInTheDocument();
  });

  it("stores the curated key when one is picked", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "athelas");
    expect(store().appearance.latinFont).toBe("athelas");
  });
});

describe("FontSettings — installed families (#1429)", () => {
  it("lists every installed family under its own heading", () => {
    mockInstalled.mockReturnValue(["LXGW WenKai", "Iosevka"]);
    render(<FontSettings />);
    expect(screen.getAllByRole("option", { name: "LXGW WenKai" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("group", { name: /installed fonts/i }).length).toBeGreaterThan(0);
  });

  it("stores a picked installed family as a custom value", async () => {
    const user = userEvent.setup();
    mockInstalled.mockReturnValue(["LXGW WenKai"]);
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "custom:LXGW WenKai");
    expect(store().appearance.latinFont).toBe("custom:LXGW WenKai");
  });

  it("offers no heading when the platform does not enumerate", () => {
    mockInstalled.mockReturnValue([]);
    render(<FontSettings />);
    expect(screen.queryByRole("group", { name: /installed fonts/i })).toBeNull();
  });
});

describe("FontSettings — typing a family name (#1429)", () => {
  it("hides the custom field until it is asked for", () => {
    render(<FontSettings />);
    expect(screen.queryByRole("combobox", { name: CUSTOM_FAMILY })).toBeNull();
  });

  it("reveals the field on Custom… without changing the stored font", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    expect(screen.getByRole("combobox", { name: CUSTOM_FAMILY })).toBeInTheDocument();
    // Nothing is applied until a usable name exists — the user's current font
    // must not be taken away by opening the field.
    expect(store().appearance.latinFont).toBe("system");
  });

  it("applies a typed family as soon as it is usable", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    await user.type(screen.getByRole("combobox", { name: CUSTOM_FAMILY }), "Iosevka");
    expect(store().appearance.latinFont).toBe("custom:Iosevka");
  });

  it("keeps an unusable draft local rather than storing it", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    const field = screen.getByRole("combobox", { name: CUSTOM_FAMILY });
    await user.type(field, 'X"; color: red');
    // The field keeps what was typed…
    expect(field).toHaveValue('X"; color: red');
    // …and the setting never took it. (Sanitizing accepted the leading "X"
    // on the way through, which is a real family name; what matters is that
    // the hostile tail never lands.)
    expect(store().appearance.latinFont).toBe("custom:X");
  });

  it("shows the field pre-filled when the stored font is already custom", () => {
    useSettingsStore.setState({
      appearance: { ...store().appearance, cjkFont: "custom:霞鹜文楷" },
    });
    render(<FontSettings />);
    const fields = screen.getAllByRole("combobox", { name: CUSTOM_FAMILY });
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveValue("霞鹜文楷");
  });

  it("keeps a custom family selectable even when it is not installed", () => {
    // Windows and Linux do not enumerate, so the stored family would match no
    // option and the select would render blank over a perfectly good value.
    useSettingsStore.setState({
      appearance: { ...store().appearance, latinFont: "custom:Some Windows Font" },
    });
    mockInstalled.mockReturnValue([]);
    render(<FontSettings />);
    expect(latinSelect()).toHaveValue("custom:Some Windows Font");
  });

  it("returns to a curated family and clears the field", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      appearance: { ...store().appearance, latinFont: "custom:Iosevka" },
    });
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "georgia");
    expect(store().appearance.latinFont).toBe("georgia");
    expect(screen.queryByRole("combobox", { name: CUSTOM_FAMILY })).toBeNull();
  });

  it("keeps each role's field independent", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(screen.getByRole("combobox", { name: CJK }), "__custom__");
    await user.type(screen.getByRole("combobox", { name: CUSTOM_FAMILY }), "LXGW WenKai");
    expect(store().appearance.cjkFont).toBe("custom:LXGW WenKai");
    expect(store().appearance.latinFont).toBe("system");
  });
});

describe("FontSettings — an unusable draft says so (#1429)", () => {
  it("replaces the hint with a reason while the draft cannot be used", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    await user.type(screen.getByRole("combobox", { name: CUSTOM_FAMILY }), "Foo, Bar");
    expect(screen.getByText(/cannot contain quotes/i)).toBeInTheDocument();
  });

  it("goes back to the ordinary hint once the draft is usable again", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    const field = screen.getByRole("combobox", { name: CUSTOM_FAMILY });
    await user.type(field, "Foo,");
    expect(screen.getByText(/cannot contain quotes/i)).toBeInTheDocument();
    await user.type(field, "{backspace}");
    expect(screen.queryByText(/cannot contain quotes/i)).toBeNull();
    expect(store().appearance.latinFont).toBe("custom:Foo");
  });

  it("says nothing about an empty field", async () => {
    const user = userEvent.setup();
    render(<FontSettings />);
    await user.selectOptions(latinSelect(), "__custom__");
    expect(screen.queryByText(/cannot contain quotes/i)).toBeNull();
  });
});
