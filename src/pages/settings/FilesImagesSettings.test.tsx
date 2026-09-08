// WI-FL5.7 — the Saving, History and Images groups of the Files & Images pane.
// These are the rows `FilesImagesSettings.tsx` keeps INLINE (its header records
// that boundary), so this mounts the whole pane; the groups it composes have
// their own tests (FileBrowserSettingsGroup, DocumentToolsSettings). Mounting
// the pane also mounts DocumentToolsSettings, whose mount effect invokes
// `detect_pandoc` — answered here with "not installed" and awaited, so the
// probe settles inside each test rather than after it.
//
// Each dependent control (Save interval; the four History selects) is disabled
// exactly while its parent toggle is off, and every control writes its own key
// with the type the store declares — numbers for intervals and sizes, even
// though a <select> can only hand back a string.
//
// Feature ledger, Area 13 "Files & Images pane" (id files-images-settings-pane).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "detect_pandoc"
      ? Promise.resolve({ available: false, path: null, version: null })
      : Promise.resolve(null),
}));

import { FilesImagesSettings } from "./FilesImagesSettings";
import { useSettingsStore } from "@/stores/settingsStore";

type General = ReturnType<typeof useSettingsStore.getState>["general"];
type NumericHistoryKey =
  | "historyMaxSnapshots"
  | "historyMaxAgeDays"
  | "historyMergeWindow"
  | "historyMaxFileSize";

const store = () => useSettingsStore.getState();

function setGeneral(patch: Partial<General>): void {
  useSettingsStore.setState({ general: { ...store().general, ...patch } });
}

const AUTO_SAVE = /^enable auto-save$/i;
const SAVE_INTERVAL = /^save interval$/i;
const PROVENANCE = /^stamp identity block on save$/i;
const KEEP_HISTORY = /^keep document history$/i;
const HISTORY_SELECTS: ReadonlyArray<[RegExp, NumericHistoryKey, string, number]> = [
  [/^maximum versions$/i, "historyMaxSnapshots", "100", 100],
  [/^keep versions for$/i, "historyMaxAgeDays", "30", 30],
  [/^merge window$/i, "historyMergeWindow", "0", 0],
  [/^max file size for history$/i, "historyMaxFileSize", "5120", 5120],
];
const AUTO_RESIZE = /^auto-resize on paste$/i;
const COPY_TO_ASSETS = /^copy to assets folder$/i;
const CLEANUP = /^clean up unused images on close$/i;

async function renderPane() {
  const user = userEvent.setup();
  render(<FilesImagesSettings />);
  await screen.findByText("Not found");
  return user;
}

beforeEach(() => {
  store().resetSettings();
});

describe("FilesImagesSettings — Saving", () => {
  it("Enable auto-save gates Save interval", async () => {
    const user = await renderPane();
    const autoSave = screen.getByRole("switch", { name: AUTO_SAVE });
    const interval = screen.getByRole("combobox", { name: SAVE_INTERVAL });
    expect(autoSave).toBeChecked();
    expect(interval).toBeEnabled();

    await user.click(autoSave);
    expect(store().general.autoSaveEnabled).toBe(false);
    expect(interval).toBeDisabled();

    await user.click(autoSave);
    expect(store().general.autoSaveEnabled).toBe(true);
    expect(interval).toBeEnabled();
  });

  it("Save interval reflects the stored seconds and writes a NUMBER", async () => {
    setGeneral({ autoSaveInterval: 60 });
    const user = await renderPane();
    const interval = screen.getByRole("combobox", { name: SAVE_INTERVAL });
    expect(interval).toHaveValue("60");

    await user.selectOptions(interval, "120");

    expect(store().general.autoSaveInterval).toBe(120);
    expect(store().general.autoSaveEnabled).toBe(true);
  });

  it("Track document provenance writes general.coherenceCaptureOnSave (opt-in, ships off)", async () => {
    const user = await renderPane();
    const provenance = screen.getByRole("switch", { name: PROVENANCE });
    expect(provenance).not.toBeChecked();

    await user.click(provenance);
    expect(store().general.coherenceCaptureOnSave).toBe(true);
  });
});

describe("FilesImagesSettings — History", () => {
  it("Keep document history gates the four retention selects", async () => {
    const user = await renderPane();
    for (const [name] of HISTORY_SELECTS) {
      expect(screen.getByRole("combobox", { name })).toBeEnabled();
    }

    await user.click(screen.getByRole("switch", { name: KEEP_HISTORY }));

    expect(store().general.historyEnabled).toBe(false);
    for (const [name] of HISTORY_SELECTS) {
      expect(screen.getByRole("combobox", { name })).toBeDisabled();
    }
    // The gate does not touch the retention values themselves.
    expect(store().general).toMatchObject({
      historyMaxSnapshots: 50,
      historyMaxAgeDays: 7,
      historyMergeWindow: 30,
      historyMaxFileSize: 512,
    });
  });

  it("the retention selects reflect the stored values", async () => {
    setGeneral({
      historyMaxSnapshots: 25,
      historyMaxAgeDays: 14,
      historyMergeWindow: 60,
      historyMaxFileSize: 1024,
    });
    await renderPane();

    expect(screen.getByRole("combobox", { name: HISTORY_SELECTS[0][0] })).toHaveValue("25");
    expect(screen.getByRole("combobox", { name: HISTORY_SELECTS[1][0] })).toHaveValue("14");
    expect(screen.getByRole("combobox", { name: HISTORY_SELECTS[2][0] })).toHaveValue("60");
    expect(screen.getByRole("combobox", { name: HISTORY_SELECTS[3][0] })).toHaveValue("1024");
  });

  it.each(HISTORY_SELECTS)(
    "%s writes %s as a number",
    async (name, key, option, expected) => {
      const user = await renderPane();
      const others = Object.fromEntries(
        HISTORY_SELECTS.filter(([, k]) => k !== key).map(([, k]) => [k, store().general[k]]),
      );

      await user.selectOptions(screen.getByRole("combobox", { name }), option);

      expect(store().general[key]).toBe(expected);
      expect(store().general).toMatchObject(others);
    },
  );
});

describe("FilesImagesSettings — Images", () => {
  it("Auto-resize on paste reflects image.autoResizeMax and writes a NUMBER", async () => {
    const user = await renderPane();
    const autoResize = screen.getByRole("combobox", { name: AUTO_RESIZE });
    expect(autoResize).toHaveValue("0");

    await user.selectOptions(autoResize, "1920");

    expect(store().image.autoResizeMax).toBe(1920);
    expect(autoResize).toHaveValue("1920");
  });

  it("Copy to assets folder and Clean up unused images write their keys independently", async () => {
    const user = await renderPane();
    const copy = screen.getByRole("switch", { name: COPY_TO_ASSETS });
    const cleanup = screen.getByRole("switch", { name: CLEANUP });
    expect(copy).toBeChecked();
    expect(cleanup).not.toBeChecked();

    await user.click(copy);
    expect(store().image).toEqual({ autoResizeMax: 0, copyToAssets: false, cleanupOrphansOnClose: false });

    await user.click(cleanup);
    expect(store().image).toEqual({ autoResizeMax: 0, copyToAssets: false, cleanupOrphansOnClose: true });
  });
});

describe("FilesImagesSettings — Quit behaviour", () => {
  const originalPlatform = navigator.platform;
  afterEach(() => {
    Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
  });

  it("Confirm quit writes general.confirmQuit and names the macOS chord", async () => {
    const user = await renderPane();
    expect(screen.getByText(/⌘Q twice/)).toBeInTheDocument();
    const confirm = screen.getByRole("switch", { name: /^confirm quit$/i });
    expect(confirm).toBeChecked();

    await user.click(confirm);
    expect(store().general.confirmQuit).toBe(false);
  });

  it("names Ctrl+Q off macOS", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    await renderPane();
    expect(screen.getByText(/Ctrl\+Q twice/)).toBeInTheDocument();
    expect(screen.queryByText(/⌘Q twice/)).not.toBeInTheDocument();
  });
});
