import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLintStore } from "../lintStore";
import { useSettingsStore } from "../settingsStore";

const existsMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: existsMock }));

describe("lintStore", () => {
  beforeEach(() => {
    useLintStore.getState().clearAllDiagnostics();
  });

  it("starts with empty diagnostics", () => {
    expect(useLintStore.getState().diagnosticsByTab).toEqual({});
  });

  it("runLint stores diagnostics keyed by tabId", () => {
    // Use a doc that triggers W01 (heading skip h1→h3)
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
    const diags = useLintStore.getState().diagnosticsByTab["tab-1"];
    expect(diags).toBeDefined();
    expect(diags!.length).toBeGreaterThan(0);
  });

  it("runLint returns the diagnostics array", () => {
    const result = useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("runLint on clean doc returns empty array", () => {
    const result = useLintStore.getState().runLint("tab-1", "# Title\n\n## Section");
    expect(result).toEqual([]);
  });

  it("clearDiagnostics removes for specific tab only", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
    useLintStore.getState().runLint("tab-2", "# Title\n\n### Skip");
    useLintStore.getState().clearDiagnostics("tab-1");
    expect(useLintStore.getState().diagnosticsByTab["tab-1"]).toBeUndefined();
    expect(useLintStore.getState().diagnosticsByTab["tab-2"]).toBeDefined();
  });

  it("clearAllDiagnostics removes everything", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
    useLintStore.getState().runLint("tab-2", "# Title\n\n### Skip");
    useLintStore.getState().clearAllDiagnostics();
    expect(useLintStore.getState().diagnosticsByTab).toEqual({});
  });

  it("selectNext wraps around", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip\n\n![](img.png)");
    const count = useLintStore.getState().diagnosticsByTab["tab-1"]!.length;
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      useLintStore.getState().selectNext("tab-1");
    }
    // Should wrap to 0
    expect(useLintStore.getState().selectedIndexByTab["tab-1"]).toBe(0);
  });

  it("selectPrev wraps to last from index 0", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip\n\n![](img.png)");
    const count = useLintStore.getState().diagnosticsByTab["tab-1"]!.length;
    // selectedIndexByTab starts at 0, selectPrev should wrap to last
    useLintStore.getState().selectPrev("tab-1");
    expect(useLintStore.getState().selectedIndexByTab["tab-1"]).toBe(count - 1);
  });

  it("selectNext/Prev with no diagnostics is a no-op", () => {
    useLintStore.getState().selectNext("nonexistent");
    expect(useLintStore.getState().selectedIndexByTab["nonexistent"]).toBeUndefined();
    useLintStore.getState().selectPrev("nonexistent");
    expect(useLintStore.getState().selectedIndexByTab["nonexistent"]).toBeUndefined();
  });

  it("selectNext falls back to 0 when selectedIndexByTab entry is missing", () => {
    // Use a doc that triggers multiple diagnostics so (0+1)%count != 0
    useLintStore.getState().runLint("tab-x", "# Title\n\n### Skip\n\n![](img.png)");
    const count = useLintStore.getState().diagnosticsByTab["tab-x"]!.length;
    expect(count).toBeGreaterThanOrEqual(2);
    // Manually remove the selectedIndex entry to force the ?? 0 fallback
    useLintStore.setState((s) => {
      const { ["tab-x"]: _, ...rest } = s.selectedIndexByTab;
      return { selectedIndexByTab: rest };
    });
    expect(useLintStore.getState().selectedIndexByTab["tab-x"]).toBeUndefined();
    useLintStore.getState().selectNext("tab-x");
    // ?? 0 fallback means current=0, so (0+1) % count = 1
    expect(useLintStore.getState().selectedIndexByTab["tab-x"]).toBe(1);
  });

  it("selectPrev falls back to 0 when selectedIndexByTab entry is missing", () => {
    // Use a doc that triggers multiple diagnostics
    useLintStore.getState().runLint("tab-y", "# Title\n\n### Skip\n\n![](img.png)");
    const count = useLintStore.getState().diagnosticsByTab["tab-y"]!.length;
    expect(count).toBeGreaterThanOrEqual(2);
    // Manually remove the selectedIndex entry to force the ?? 0 fallback
    useLintStore.setState((s) => {
      const { ["tab-y"]: _, ...rest } = s.selectedIndexByTab;
      return { selectedIndexByTab: rest };
    });
    expect(useLintStore.getState().selectedIndexByTab["tab-y"]).toBeUndefined();
    useLintStore.getState().selectPrev("tab-y");
    // ?? 0 fallback means current=0, 0 <= 0 so wraps to last
    expect(useLintStore.getState().selectedIndexByTab["tab-y"]).toBe(count - 1);
  });

  it("selectPrev decrements when current > 0", () => {
    useLintStore.getState().runLint("tab-z", "# Title\n\n### Skip\n\n![](img.png)");
    const count = useLintStore.getState().diagnosticsByTab["tab-z"]!.length;
    expect(count).toBeGreaterThanOrEqual(2);
    // Move forward first so current > 0
    useLintStore.getState().selectNext("tab-z");
    expect(useLintStore.getState().selectedIndexByTab["tab-z"]).toBe(1);
    // Now selectPrev should decrement to 0 (current - 1 branch)
    useLintStore.getState().selectPrev("tab-z");
    expect(useLintStore.getState().selectedIndexByTab["tab-z"]).toBe(0);
  });

  it("resets selectedIndexByTab when running lint on new content", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip\n\n![](img.png)");
    // Move to index 1
    useLintStore.getState().selectNext("tab-1");
    expect(useLintStore.getState().selectedIndexByTab["tab-1"]).toBe(1);
    // Re-run lint resets index to 0
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
    expect(useLintStore.getState().selectedIndexByTab["tab-1"]).toBe(0);
  });

  it("selectedIndexByTab is independent across tabs", () => {
    useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip\n\n![](img.png)");
    useLintStore.getState().runLint("tab-2", "# Title\n\n### Skip\n\n![](img.png)");
    // Advance tab-1 once; tab-2 should remain at 0
    useLintStore.getState().selectNext("tab-1");
    expect(useLintStore.getState().selectedIndexByTab["tab-1"]).toBe(1);
    expect(useLintStore.getState().selectedIndexByTab["tab-2"]).toBe(0);
  });

  describe("settings subscription", () => {
    it("clears all diagnostics when lint is disabled", () => {
      // Ensure lint is enabled first
      useSettingsStore.setState({
        markdown: { ...useSettingsStore.getState().markdown, lintEnabled: true },
      });

      // Add some diagnostics
      useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
      expect(Object.keys(useLintStore.getState().diagnosticsByTab).length).toBeGreaterThan(0);

      // Disable lint
      useSettingsStore.setState({
        markdown: { ...useSettingsStore.getState().markdown, lintEnabled: false },
      });

      // Diagnostics should be cleared
      expect(useLintStore.getState().diagnosticsByTab).toEqual({});
    });

    it("does not clear diagnostics when lint stays enabled", () => {
      useSettingsStore.setState({
        markdown: { ...useSettingsStore.getState().markdown, lintEnabled: true },
      });

      useLintStore.getState().runLint("tab-1", "# Title\n\n### Skip");
      const before = Object.keys(useLintStore.getState().diagnosticsByTab).length;

      // Toggle another setting (lint stays enabled)
      useSettingsStore.setState({
        markdown: { ...useSettingsStore.getState().markdown, lintEnabled: true },
      });

      expect(Object.keys(useLintStore.getState().diagnosticsByTab).length).toBe(before);
    });
  });

  describe("runLinkCheck race-condition guards (Codex audit HIGH-1)", () => {
    beforeEach(() => {
      existsMock.mockReset();
    });

    it("returns empty + no-ops when filePath is null", async () => {
      const result = await useLintStore
        .getState()
        .runLinkCheck("tab-1", "[link](./missing.md)\n", null);
      expect(result).toEqual([]);
      expect(existsMock).not.toHaveBeenCalled();
    });

    it("REPLACES prior link-check diagnostics (M001/M002), preserves other rules", async () => {
      // Seed with a non-link-check diagnostic.
      useLintStore.setState({
        diagnosticsByTab: {
          "tab-1": [
            {
              id: "E01-1-1",
              ruleId: "E01",
              severity: "error",
              messageKey: "lint.E01",
              messageParams: { ref: "x" },
              line: 1,
              column: 1,
              offset: 0,
              uiHint: "exact",
            },
          ],
        },
      });
      existsMock.mockResolvedValue(false);
      await useLintStore
        .getState()
        .runLinkCheck("tab-1", "[link](./missing.md)\n", "/repo/x.md");
      const after = useLintStore.getState().diagnosticsByTab["tab-1"];
      // E01 preserved; M001/M002 added.
      expect(after.find((d) => d.ruleId === "E01")).toBeTruthy();
      expect(after.find((d) => d.ruleId === "M002")).toBeTruthy();
    });

    it("clearDiagnostics invalidates pending runLinkCheck tokens", async () => {
      let resolveSlow!: (v: boolean) => void;
      existsMock.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSlow = resolve;
          }),
      );

      const slowPromise = useLintStore
        .getState()
        .runLinkCheck("tab-1", "[a](./missing.md)\n", "/repo/x.md");

      // User clears the tab while fs.exists is still pending.
      useLintStore.getState().clearDiagnostics("tab-1");
      expect(useLintStore.getState().diagnosticsByTab["tab-1"]).toBeUndefined();

      // Slow path resolves with file-missing — would have written
      // diagnostics. The token guard must drop the result.
      resolveSlow(false);
      await slowPromise;

      expect(useLintStore.getState().diagnosticsByTab["tab-1"]).toBeUndefined();
    });

    it("clearAllDiagnostics invalidates all pending runLinkCheck tokens", async () => {
      let resolveSlow!: (v: boolean) => void;
      existsMock.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSlow = resolve;
          }),
      );
      const slowPromise = useLintStore
        .getState()
        .runLinkCheck("tab-1", "[a](./x.md)\n", "/repo/x.md");
      useLintStore.getState().clearAllDiagnostics();
      resolveSlow(false);
      await slowPromise;
      expect(useLintStore.getState().diagnosticsByTab).toEqual({});
    });

    it("a stale runLinkCheck completion does not overwrite a fresher one", async () => {
      // First call: slow to resolve. Second call: fast. The first must
      // not overwrite the second's results when its fs.exists() finally
      // settles.
      let resolveSlow!: (v: boolean) => void;
      existsMock.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSlow = resolve;
          }),
      );
      existsMock.mockResolvedValueOnce(true); // fast: file exists

      const slowPromise = useLintStore
        .getState()
        .runLinkCheck("tab-1", "[a](./old.md)\n", "/repo/x.md");
      const fastPromise = useLintStore
        .getState()
        .runLinkCheck("tab-1", "[a](./new.md)\n", "/repo/x.md");

      // Fast path resolves first — file "new.md" exists → no diagnostics.
      const fast = await fastPromise;
      expect(fast.filter((d) => d.ruleId === "M002").length).toBe(0);

      // Now resolve the slow path with file-missing.
      resolveSlow(false);
      await slowPromise;

      // Stale completion must NOT have overwritten the empty state.
      const final = useLintStore.getState().diagnosticsByTab["tab-1"] ?? [];
      expect(final.filter((d) => d.ruleId === "M002").length).toBe(0);
    });
  });
});
