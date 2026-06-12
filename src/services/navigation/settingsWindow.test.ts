/**
 * Tests for src/utils/settingsWindow.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openSettingsWindow } from "./settingsWindow";

describe("openSettingsWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue("settings");
  });

  it("delegates Settings window creation to Rust", async () => {
    await openSettingsWindow();

    expect(invoke).toHaveBeenCalledWith("open_settings_window", {
      section: null,
    });
  });

  it("passes a requested section to Rust", async () => {
    await openSettingsWindow("about");

    expect(invoke).toHaveBeenCalledWith("open_settings_window", {
      section: "about",
    });
  });

  it("normalizes empty section to null", async () => {
    await openSettingsWindow("");

    expect(invoke).toHaveBeenCalledWith("open_settings_window", {
      section: null,
    });
  });

  it("propagates backend failures to callers", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("failed"));

    await expect(openSettingsWindow()).rejects.toThrow("failed");
  });
});
