// WI-FL5.8 — ThemedToaster: the sonner mount follows the app theme (ledger F7,
// resilient-chrome / WI-UI1.6). Real sonner, real settings store: the subject
// is the theme sonner is actually handed, read back off its own container.
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import { ThemedToaster } from "./ThemedToaster";

// Sonner mounts its list lazily (a tick after the first toast) and labels the
// palette it picked `data-sonner-theme`.
const toasterEl = () => document.querySelector("[data-sonner-toaster]");
const toasterTheme = () => toasterEl()?.getAttribute("data-sonner-theme") ?? null;

async function expectTheme(theme: "light" | "dark") {
  await waitFor(() => expect(toasterTheme()).toBe(theme));
}

function setTheme(theme: "paper" | "night" | "solarized" | "white") {
  act(() => {
    useSettingsStore.getState().updateAppearanceSetting("theme", theme);
  });
}

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
  useSettingsStore.getState().updateAppearanceSetting("followSystemAppearance", false);
  useSystemAppearanceStore.setState({ prefersDark: false });
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

/** A toast has to exist for sonner to render its container at all. */
function renderWithToast(emit: () => void = () => toast("hello")) {
  const view = render(<ThemedToaster />);
  act(emit);
  return view;
}

describe("ThemedToaster", () => {
  it("hands sonner the light palette on a light theme and the dark palette on a dark one", async () => {
    renderWithToast();
    await expectTheme("light");

    setTheme("night");
    await expectTheme("dark");

    setTheme("solarized");
    await expectTheme("dark");

    setTheme("white");
    await expectTheme("light");
  });

  it("switching theme while a toast is showing re-themes the live toaster — no remount needed", async () => {
    renderWithToast();
    await expectTheme("light");
    const before = toasterEl();

    setTheme("night");

    await expectTheme("dark");
    expect(toasterEl()).toBe(before);
  });

  it("follows the OS preference when follow-system-appearance is on (#1125)", async () => {
    act(() => {
      useSettingsStore.getState().updateAppearanceSetting("followSystemAppearance", true);
    });
    renderWithToast();
    await expectTheme("light");

    act(() => {
      useSystemAppearanceStore.setState({ prefersDark: true });
    });
    await expectTheme("dark");
  });

  it("mounts at top-center with a close button and the severity icon set", async () => {
    renderWithToast(() => toast.success("saved"));
    await waitFor(() => expect(toasterEl()).not.toBeNull());

    expect(toasterEl()?.getAttribute("data-y-position")).toBe("top");
    expect(toasterEl()?.getAttribute("data-x-position")).toBe("center");
    const item = document.querySelector("[data-sonner-toast]");
    expect(item?.getAttribute("data-type")).toBe("success");
    expect(item?.querySelector("[data-close-button]")).not.toBeNull();
    expect(item?.querySelector("[data-icon] svg")).not.toBeNull(); // our lucide icon, not sonner's default
  });
});
