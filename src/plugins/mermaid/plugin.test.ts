/**
 * Tests for mermaid plugin render internals (plugin.ts).
 *
 * Mocks the mermaid module so no real rendering happens. Covers the
 * null-on-failure contract of renderMermaid/renderMermaidForExport,
 * load-failure retry (no cached rejected promise), and global-config
 * safety for export renders (restore on throw + serialization with
 * live renders).
 *
 * isMermaidSyntax tests live in mermaid.test.ts.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const mockInitialize = vi.fn();
const mockRender = vi.fn();
const mockDiagramWarn = vi.fn();

/** Toggled per-test to make the dynamic import("mermaid") fail. */
const importState = { fail: false };

vi.mock("@/utils/debug", () => ({
  diagramWarn: (...args: unknown[]) => mockDiagramWarn(...args),
}));

type PluginModule = typeof import("./plugin");

/**
 * Fresh module instance per test so cached module/promise state resets.
 * Uses vi.doMock (not hoisted vi.mock) for the mermaid module: doMock
 * re-runs the factory on every dynamic import, which lets tests simulate
 * a failed chunk load followed by a successful retry.
 */
async function loadPlugin(): Promise<PluginModule> {
  vi.resetModules();
  vi.doMock("mermaid", () => {
    if (importState.fail) {
      throw new Error("chunk load failed");
    }
    return {
      default: {
        initialize: (...args: unknown[]) => mockInitialize(...args),
        render: (...args: unknown[]) => mockRender(...args),
      },
    };
  });
  return await import("./plugin");
}

beforeEach(() => {
  vi.clearAllMocks();
  importState.fail = false;
  document.documentElement.className = "";
  mockRender.mockResolvedValue({ svg: "<svg>live</svg>" });
  mockInitialize.mockImplementation(() => {});
});

describe("renderMermaid", () => {
  it("renders content to SVG with the live 'base' theme config", async () => {
    const { renderMermaid } = await loadPlugin();

    const svg = await renderMermaid("graph TD; A-->B", "test-id");

    expect(svg).toBe("<svg>live</svg>");
    expect(mockRender).toHaveBeenCalledWith("test-id", "graph TD; A-->B");
    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "base", startOnLoad: false }),
    );
  });

  it("returns null and warns when the mermaid module fails to load, then retries on the next call", async () => {
    importState.fail = true;
    const { renderMermaid } = await loadPlugin();

    // Init failure must honor the null-on-failure contract, not throw.
    await expect(renderMermaid("graph TD; A")).resolves.toBeNull();
    expect(mockDiagramWarn).toHaveBeenCalled();

    // A failed load must not be cached: the next call retries and succeeds.
    importState.fail = false;
    await expect(renderMermaid("graph TD; A")).resolves.toBe("<svg>live</svg>");
  });

  it("returns null when mermaid.initialize throws during init, then retries on the next call", async () => {
    mockInitialize.mockImplementationOnce(() => {
      throw new Error("bad config");
    });
    const { renderMermaid } = await loadPlugin();

    await expect(renderMermaid("graph TD; A")).resolves.toBeNull();
    await expect(renderMermaid("graph TD; A")).resolves.toBe("<svg>live</svg>");
  });

  it("returns null and warns when rendering fails", async () => {
    mockRender.mockRejectedValue(new Error("parse error"));
    const { renderMermaid } = await loadPlugin();

    await expect(renderMermaid("not a diagram")).resolves.toBeNull();
    expect(mockDiagramWarn).toHaveBeenCalledWith(
      "Failed to render diagram:",
      expect.any(Error),
    );
  });
});

describe("renderMermaidForExport", () => {
  it("renders with the export theme, then restores the live config", async () => {
    const { renderMermaid, renderMermaidForExport } = await loadPlugin();
    await renderMermaid("graph TD; A"); // warm live init

    const svg = await renderMermaidForExport("graph TD; A", "dark");

    expect(svg).toBe("<svg>live</svg>");
    const themes = mockInitialize.mock.calls.map(
      (call) => (call[0] as { theme: string }).theme,
    );
    expect(themes).toContain("dark");
    // Last initialize call must be the restored live config.
    expect(themes.at(-1)).toBe("base");
  });

  it("returns null when the module fails to load (null-on-failure contract)", async () => {
    importState.fail = true;
    const { renderMermaidForExport } = await loadPlugin();

    await expect(
      renderMermaidForExport("graph TD; A", "light"),
    ).resolves.toBeNull();
  });

  it("restores the live config even when the export initialize throws", async () => {
    const { renderMermaid, renderMermaidForExport } = await loadPlugin();
    await renderMermaid("graph TD; A"); // warm live init (theme "base")

    // The next initialize call is the export one — make it throw.
    mockInitialize.mockImplementationOnce((config: unknown) => {
      throw new Error(
        `boom on ${(config as { theme: string }).theme} config`,
      );
    });

    await expect(
      renderMermaidForExport("graph TD; A", "dark"),
    ).resolves.toBeNull();

    // The live config must have been restored after the throw.
    const lastInit = mockInitialize.mock.calls.at(-1)?.[0] as {
      theme: string;
    };
    expect(lastInit.theme).toBe("base");
  });

  it("serializes with live renders: a live render started during an export uses the live theme", async () => {
    // Track which global config is active when each render STARTS —
    // mermaid reads the global config during render, so a live render
    // that starts while the export config is active would use it.
    let activeTheme = "none";
    mockInitialize.mockImplementation((config: unknown) => {
      activeTheme = (config as { theme: string }).theme;
    });
    mockRender.mockImplementation(async () => {
      const themeAtStart = activeTheme;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { svg: `<svg data-theme="${themeAtStart}"></svg>` };
    });

    const { renderMermaid, renderMermaidForExport } = await loadPlugin();
    await renderMermaid("graph TD; A"); // warm live init

    const [exportSvg, liveSvg] = await Promise.all([
      renderMermaidForExport("graph TD; A", "dark"),
      renderMermaid("graph TD; B"),
    ]);

    expect(exportSvg).toContain('data-theme="dark"');
    expect(liveSvg).toContain('data-theme="base"');
  });
});

describe("updateMermaidTheme / updateMermaidFontSize", () => {
  it("detects changes without initializing mermaid outside the render lock", async () => {
    const { renderMermaid, updateMermaidTheme, updateMermaidFontSize } =
      await loadPlugin();
    await renderMermaid("graph TD; A");
    const callsAfterRender = mockInitialize.mock.calls.length;

    // No token change → no report, no initialize.
    await expect(updateMermaidTheme()).resolves.toBe(false);

    // Token change: reported once, but the library must NOT be touched —
    // mermaid.initialize during an in-flight render is the race the render
    // lock exists to prevent; config is applied lazily by the next render.
    document.documentElement.style.setProperty("--text-color", "#123456");
    await expect(updateMermaidTheme()).resolves.toBe(true);
    await expect(updateMermaidTheme()).resolves.toBe(false);
    updateMermaidFontSize();
    expect(mockInitialize.mock.calls.length).toBe(callsAfterRender);

    // The next locked render applies the new config.
    await renderMermaid("graph TD; B");
    expect(mockInitialize.mock.calls.length).toBeGreaterThan(callsAfterRender);
  });
});
