// The File Browser settings group.
//
// #1224 — consumer tests (tree, tab strip, title bar) and the defaults test all
// read `general.showFileExtensions`, so every one of them passes while the
// settings row itself is wired to nothing. This covers the rows themselves:
// that they reflect stored values, and that operating them writes back.
//
// Renders the GROUP, not the whole panel. Rendering FilesImagesSettings mounted
// DocumentToolsSettings too, whose mount effect invokes the `detect_pandoc`
// Tauri command — so a three-row assertion silently depended on Pandoc
// detection and a permissive global mock. The tradeoff is that this no longer
// proves the parent mounts the group; that is one line of static composition,
// covered by typechecking and review.
//
// Real settings and workspace stores; RTL queries by accessible role/name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileBrowserSettingsGroup } from "./FileBrowserSettingsGroup";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { normalizeWorkspaceConfig } from "@/stores/workspaceConfigDefaults";
import { useSettingsStore } from "@/stores/settingsStore";

const LABEL = /show file extensions/i;

const initial = useSettingsStore.getState().general;

function setShowExtensions(value: boolean) {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, showFileExtensions: value },
  });
}

beforeEach(() => {
  setShowExtensions(true);
  useWorkspaceStore.setState({
    rootPath: "/workspace",
    isWorkspaceMode: true,
    config: normalizeWorkspaceConfig(null),
  });
});
afterEach(() => useSettingsStore.setState({ general: initial }));

describe("FileBrowserSettingsGroup", () => {
  it("reflects the stored value", () => {
    render(<FileBrowserSettingsGroup />);
    expect(screen.getByRole("switch", { name: LABEL })).toBeChecked();

    act(() => setShowExtensions(false));
    expect(screen.getByRole("switch", { name: LABEL })).not.toBeChecked();
  });

  it("writes the change back to the store", async () => {
    const user = userEvent.setup();
    render(<FileBrowserSettingsGroup />);

    await user.click(screen.getByRole("switch", { name: LABEL }));
    expect(useSettingsStore.getState().general.showFileExtensions).toBe(false);

    await user.click(screen.getByRole("switch", { name: LABEL }));
    expect(useSettingsStore.getState().general.showFileExtensions).toBe(true);
  });

  // The two rows above it are workspace-scoped and disable themselves without
  // a workspace. This one is global — a tab strip and a title bar exist with
  // no folder open, so the switch has to stay operable.
  it("stays enabled outside workspace mode", () => {
    useWorkspaceStore.setState({ rootPath: null, isWorkspaceMode: false, config: null });
    render(<FileBrowserSettingsGroup />);
    expect(screen.getByRole("switch", { name: LABEL })).toBeEnabled();
  });
});

// The other two rows in this group. They were extracted with it and had no
// direct coverage of their own — the previous test file asserted only the
// extensions row while mounting all three.
describe("FileBrowserSettingsGroup — the workspace-scoped rows", () => {
  const HIDDEN = /show hidden files/i;
  const ALL = /show all files/i;

  it("reflects the stored workspace values", () => {
    useWorkspaceStore.setState({
      config: normalizeWorkspaceConfig({ showHiddenFiles: true, showAllFiles: false }),
    });
    render(<FileBrowserSettingsGroup />);
    expect(screen.getByRole("switch", { name: HIDDEN })).toBeChecked();
    expect(screen.getByRole("switch", { name: ALL })).not.toBeChecked();
  });

  it("disables both without a workspace, since the config is per workspace", () => {
    // `updateWorkspaceConfig` is a no-op outside workspace mode, so an enabled
    // switch here would be a control that silently does nothing.
    useWorkspaceStore.setState({ rootPath: null, isWorkspaceMode: false, config: null });
    render(<FileBrowserSettingsGroup />);
    expect(screen.getByRole("switch", { name: HIDDEN })).toBeDisabled();
    expect(screen.getByRole("switch", { name: ALL })).toBeDisabled();
  });
});
