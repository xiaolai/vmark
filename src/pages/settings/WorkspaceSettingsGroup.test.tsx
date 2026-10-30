// The Workspace settings group: its one row, the workspace-rail toggle.
//
// Consumers of `general.workspaceRailMode` (the rail, the shell layout) are
// tested against the stored value; this covers the row itself — that it shows
// the stored value and that operating it writes back, in both directions.
//
// Real settings store; RTL queries by accessible role and name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceSettingsGroup } from "./WorkspaceSettingsGroup";
import { useSettingsStore } from "@/stores/settingsStore";

const LABEL = /workspace rail/i;
const initial = useSettingsStore.getState().general;

function setRailMode(value: boolean) {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: value },
  });
}

beforeEach(() => setRailMode(false));
afterEach(() => useSettingsStore.setState({ general: initial }));

describe("WorkspaceSettingsGroup", () => {
  it("labels the group and describes what the toggle does", () => {
    render(<WorkspaceSettingsGroup />);
    expect(screen.getByText(/keep multiple workspaces and loose files in one window/i)).toBeInTheDocument();
  });

  it("reflects the stored value", () => {
    render(<WorkspaceSettingsGroup />);
    expect(screen.getByRole("switch", { name: LABEL })).not.toBeChecked();

    act(() => setRailMode(true));
    expect(screen.getByRole("switch", { name: LABEL })).toBeChecked();
  });

  it("turns the rail on and off again", async () => {
    const user = userEvent.setup();
    render(<WorkspaceSettingsGroup />);
    const toggle = screen.getByRole("switch", { name: LABEL });

    await user.click(toggle);
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(true);

    await user.click(toggle);
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(false);
  });
});
