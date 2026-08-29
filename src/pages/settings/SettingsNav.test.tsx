// WI-UI1.8 — keyboard focus is visible on the Settings navigation.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsNav, type SettingsNavProps } from "./SettingsNav";

const props: SettingsNavProps = {
  isMac: true,
  items: [
    { id: "general", label: "General", icon: null },
    { id: "appearance", label: "Appearance", icon: null },
    { id: "files", label: "Files", icon: null },
    { id: "shortcuts", label: "Shortcuts", icon: null },
  ] as SettingsNavProps["items"],
  section: "general" as SettingsNavProps["section"],
  searching: false,
  searchQuery: "",
  onSearch: vi.fn(),
  onSelect: vi.fn(),
};

describe("SettingsNav focus visibility (C10/rule 33)", () => {
  it("every nav item paints keyboard focus via a focus-visible outline class", () => {
    render(<SettingsNav {...props} />);
    const buttons = screen.getAllByRole("button").filter((b) => b.dataset.active !== undefined);
    expect(buttons.length).toBeGreaterThan(3);
    for (const btn of buttons) {
      expect(btn.className, btn.textContent ?? "").toContain("focus-visible:outline");
    }
  });

  it("the active item keeps its ink (R6) — accent background, text colour text", () => {
    render(<SettingsNav {...props} />);
    const active = screen.getAllByRole("button").find((b) => b.dataset.active === "true");
    expect(active).toBeDefined();
    expect(active!.className).toContain("data-[active=true]:text-[var(--text-color)]");
    expect(active!.className).not.toContain("data-[active=true]:text-[var(--accent-primary)]");
  });
});
