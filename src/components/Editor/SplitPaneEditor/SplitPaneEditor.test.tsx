// WI-1A.4 + WI-1A.10 — SplitPaneEditor tests.
//
// Verifies skeleton structure, source/preview/validator slot wiring,
// resize-handle keyboard support, ARIA roles, and theme parity.

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormatConfig, ValidationDiagnostic } from "@/lib/formats/types";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { SplitPaneEditor } from "./SplitPaneEditor";

// CodeMirror is heavy and requires DOM; mock the source pane.
vi.mock("./SourcePane", () => ({
  SourcePane: ({ tabId, formatId }: { tabId: string; formatId: string }) => (
    <div data-testid="source-pane" data-tab-id={tabId} data-format-id={formatId}>
      source
    </div>
  ),
}));

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ name: "JSON", extensions: ["json"] }],
  untitledExtension: "json",
  readOnlyDefault: false,
  closeSavePolicy: "prompt-on-close",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const jsonStub: FormatConfig = {
  id: "json",
  nameI18nKey: "format.json",
  extensions: ["json"],
  kind: "split-pane",
  adapters: baseAdapters,
};

const txtStub: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: baseAdapters,
};

function GenericPreview({ content }: { content: string }) {
  return <div data-testid="preview-content">preview:{content}</div>;
}

describe("SplitPaneEditor", () => {
  afterEach(() => {
    cleanup();
    // Isolate view-mode tests: reset the global default back to "split".
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, defaultViewMode: "split" },
    }));
  });

  function setDefaultViewMode(mode: "source" | "split" | "preview") {
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, defaultViewMode: mode },
    }));
  }

  describe("skeleton (WI-1A.4)", () => {
    it("renders source pane slot", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
    });

    it("renders no preview pane when format has no genericPreview / schemaRenderers", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.queryByTestId("preview-content")).not.toBeInTheDocument();
    });

    it("renders preview pane when format declares genericPreview", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
    });

    it("renders validator slot when validator is declared", () => {
      const validator = (() => [
        { severity: "error", line: 1, column: 1, message: "boom" },
      ]) as FormatConfig["validator"];
      const config: FormatConfig = { ...jsonStub, validator };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      // Validator gutter is owned by SourcePane; here we only verify the
      // outer skeleton renders the dual-pane container.
      expect(screen.getByRole("group")).toBeInTheDocument();
    });

    it("forwards tabId + formatId to source pane", () => {
      render(<SplitPaneEditor tabId="tab-99" formatConfig={jsonStub} />);
      const src = screen.getByTestId("source-pane");
      expect(src).toHaveAttribute("data-tab-id", "tab-99");
      expect(src).toHaveAttribute("data-format-id", "json");
    });
  });

  describe("polish: resize handle (WI-1A.10)", () => {
    it("renders a resize handle when preview is present", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toBeInTheDocument();
    });

    it("omits the resize handle when no preview is rendered", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("resize handle exposes ARIA orientation", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
    });

    it("resize handle is keyboard focusable", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toHaveAttribute("tabindex", "0");
    });

    it("ArrowLeft on the handle decreases the source pane fraction", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("{ArrowLeft}");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(after)).toBeLessThan(parseFloat(before));
    });

    it("ArrowRight on the handle increases the source pane fraction", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("{ArrowRight}");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    });

    it("Home key snaps to minimum fraction (0.2)", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      await user.keyboard("{Home}");
      const fraction = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(fraction).toBeCloseTo(0.2);
    });

    it("End key snaps to maximum fraction (0.8)", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      await user.keyboard("{End}");
      const fraction = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(fraction).toBeCloseTo(0.8);
    });

    it("ignores keys other than Arrow / Home / End", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("a");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(after).toBe(before);
    });

    it("clamps fraction within [0.2, 0.8]", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      // Mash ArrowLeft a lot — should clamp to 0.2, not go below.
      for (let i = 0; i < 50; i++) await user.keyboard("{ArrowLeft}");
      const min = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(min).toBeGreaterThanOrEqual(0.2);
      // And the other direction.
      for (let i = 0; i < 100; i++) await user.keyboard("{ArrowRight}");
      const max = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(max).toBeLessThanOrEqual(0.8);
    });
  });

  describe("validator integration", () => {
    it("renders zero diagnostics for empty content", () => {
      const validator = (() => [] as ValidationDiagnostic[]) as FormatConfig["validator"];
      const config: FormatConfig = { ...jsonStub, validator };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      // No diagnostics → no error gutter rendered yet (gutter component
      // owned by SourcePane in this skeleton; outer skeleton just supplies).
      expect(screen.queryByTestId("validation-summary")).not.toBeInTheDocument();
    });
  });

  describe("view modes (WI-1.2 / WI-1.3)", () => {
    const previewConfig: FormatConfig = {
      ...jsonStub,
      genericPreview: GenericPreview,
    };

    // Unique path per call — createTab dedupes by file path, so reusing one
    // path would return a prior test's tab (with its leftover viewMode).
    let tabSeq = 0;
    function makeTab(): string {
      tabSeq += 1;
      return useTabStore.getState().createTab("main", `/page-${tabSeq}.json`);
    }

    it("split mode renders source, preview, and resize handle", () => {
      const id = makeTab(); // no override → settings default "split"
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("source mode renders source only — no preview, no handle", () => {
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "source");
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
      expect(screen.queryByTestId("preview-content")).not.toBeInTheDocument();
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("preview mode renders preview only — no source, no handle", () => {
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "preview");
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      expect(screen.queryByTestId("source-pane")).not.toBeInTheDocument();
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("per-tab viewMode overrides the global default", () => {
      setDefaultViewMode("preview");
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "source");
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      // The tab's "source" override wins over the "preview" setting.
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
      expect(screen.queryByTestId("preview-content")).not.toBeInTheDocument();
    });

    it("an unset tab falls back to the global default setting", () => {
      setDefaultViewMode("preview");
      const id = makeTab(); // no per-tab override
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      expect(screen.queryByTestId("source-pane")).not.toBeInTheDocument();
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
    });

    it("a preview-less format ignores viewMode:preview and stays source-only", () => {
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "preview");
      render(<SplitPaneEditor tabId={id} formatConfig={txtStub} />);
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
      expect(screen.queryByTestId("preview-content")).not.toBeInTheDocument();
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("shows the view-mode toggle when the format has a preview", () => {
      const id = makeTab();
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });

    it("hides the view-mode toggle when the format has no preview", () => {
      const id = makeTab();
      render(<SplitPaneEditor tabId={id} formatConfig={txtStub} />);
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    });

    it("falls back to split when the resolved mode is invalid (corrupt setting)", () => {
      // Simulate a corrupt persisted default (bypasses the typed setter).
      useSettingsStore.setState((s) => ({
        formats: { ...s.formats, defaultViewMode: "bogus" as unknown as "split" },
      }));
      const id = makeTab();
      render(<SplitPaneEditor tabId={id} formatConfig={previewConfig} />);
      // Normalized back to split → all three panes render.
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("does not crash in preview mode when the validator throws", () => {
      const boom = (() => {
        throw new Error("boom");
      }) as FormatConfig["validator"];
      const config: FormatConfig = {
        ...jsonStub,
        genericPreview: GenericPreview,
        validator: boom,
      };
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "preview");
      expect(() =>
        render(<SplitPaneEditor tabId={id} formatConfig={config} />),
      ).not.toThrow();
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
    });

    it("preview-only mode hands the full width share to the preview", () => {
      // Regression: the CSS gives the preview `flex-grow: calc(1 - fraction)`
      // with `flex-basis: 0`, so a fraction of 1 in preview-only mode collapsed
      // the preview to zero width — rendered in the DOM, invisible on screen.
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "preview");
      const { container } = render(
        <SplitPaneEditor tabId={id} formatConfig={previewConfig} />,
      );
      const fraction = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(fraction)).toBe(0);
    });

    it("source-only mode hands the full width share to the source", () => {
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "source");
      const { container } = render(
        <SplitPaneEditor tabId={id} formatConfig={previewConfig} />,
      );
      const fraction = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(fraction)).toBe(1);
    });

    it("read-only viewer banner persists in preview mode (WI-1.3)", () => {
      const viewerPreview: FormatConfig = {
        ...jsonStub,
        kind: "viewer",
        genericPreview: GenericPreview,
        adapters: { ...baseAdapters, readOnlyDefault: true },
      };
      const id = makeTab();
      useTabStore.getState().setTabViewMode(id, "preview");
      const { container } = render(
        <SplitPaneEditor tabId={id} formatConfig={viewerPreview} />,
      );
      // Banner is outside the body → present even with the source unmounted.
      expect(container.querySelector(".read-only-banner")).toBeInTheDocument();
      expect(screen.queryByTestId("source-pane")).not.toBeInTheDocument();
    });
  });

  describe("schema dispatch (WI-2.4 / WI-1A.13)", () => {
    function SchemaPreviewA() {
      return <div data-testid="preview-content">schema-a</div>;
    }
    function SchemaPreviewB() {
      return <div data-testid="preview-content">schema-b</div>;
    }

    const schemaConfig: FormatConfig = {
      ...jsonStub,
      genericPreview: GenericPreview,
      schemaRenderers: { "schema-a": SchemaPreviewA, "schema-b": SchemaPreviewB },
      schemaDetector: () => "schema-a",
    };

    let seq = 0;
    function makeSchemaTab(): string {
      seq += 1;
      return useTabStore.getState().createTab("main", `/schema-${seq}.json`);
    }

    it("prefers the detected schema renderer over the generic preview", () => {
      render(<SplitPaneEditor tabId={makeSchemaTab()} formatConfig={schemaConfig} />);
      expect(screen.getByTestId("preview-content")).toHaveTextContent("schema-a");
    });

    it("falls back to the generic preview when the detected schema is unknown", () => {
      const config: FormatConfig = { ...schemaConfig, schemaDetector: () => "nope" };
      render(<SplitPaneEditor tabId={makeSchemaTab()} formatConfig={config} />);
      expect(screen.getByTestId("preview-content")).toHaveTextContent("preview:");
    });

    it("falls back to the generic preview when the detector throws", () => {
      const config: FormatConfig = {
        ...schemaConfig,
        schemaDetector: () => {
          throw new Error("broken detector");
        },
      };
      expect(() =>
        render(<SplitPaneEditor tabId={makeSchemaTab()} formatConfig={config} />),
      ).not.toThrow();
      expect(screen.getByTestId("preview-content")).toHaveTextContent("preview:");
    });

    it("an explicit activeSchemaId outranks the detector", () => {
      const id = makeSchemaTab();
      useTabStore.getState().setTabActiveSchemaId(id, "schema-b");
      render(<SplitPaneEditor tabId={id} formatConfig={schemaConfig} />);
      // Detector says schema-a; the persisted per-tab pick says schema-b.
      expect(screen.getByTestId("preview-content")).toHaveTextContent("schema-b");
    });

    it("an unregistered activeSchemaId falls back to the detector", () => {
      const id = makeSchemaTab();
      useTabStore.getState().setTabActiveSchemaId(id, "schema-gone");
      render(<SplitPaneEditor tabId={id} formatConfig={schemaConfig} />);
      expect(screen.getByTestId("preview-content")).toHaveTextContent("schema-a");
    });
  });

  // The preview receives a DEFERRED value (#1273). Rendering it was costing a
  // full DOMPurify pass and an iframe rebuild per keystroke.
  //
  // MEASURED IN JSDOM, not WebKit: ~150 ms p50 / 210 ms p90 for one sanitize of
  // a 207 KB document, against 0.6 ms at 8 KB. Treat the absolute numbers as an
  // UPPER BOUND — jsdom's DOM is slower than JavaScriptCore's, and the app runs
  // in WKWebView. What survives the engine change is the ~250x SCALING with
  // document size, which is algorithmic (DOMPurify walks the whole tree), and
  // that is the part this decision rests on.
  //
  // Not measured at all: the iframe srcdoc teardown/reparse, which is on top of
  // the sanitize, and end-to-end input latency. Those need the running app —
  // same caveat `src/bench/largeFile.bench.ts` carries for the editor stack.
  //
  // `useDeferredValue` rather than a debounce, matching OutlineView and
  // StatusBarCounts, which solve the same problem the same way: no timer to
  // pick a constant for or isolate in tests, and no fixed lag — a small
  // document stays effectively synchronous while a burst drops its
  // intermediate values. Applied at this seam rather than inside each adapter
  // because none of them debounced — one defect with six faces (html, mermaid,
  // svg, json, yaml, toml) — and formats.md had claimed this pane was
  // debounced since before any of them existed.
  //
  // Deliberately NOT deferred: `previewDiagnostics`, which annotates the SOURCE
  // gutter and must track the caret; and the GHA workbench, which binds by
  // tabId, serializes from useDocumentStore.getState(), and syncs cursor↔canvas
  // through a source-pane CodeMirror extension — none of that uses this prop.
  //
  // Deferral is a scheduling PRIORITY, not a delay, and React only drops
  // intermediate values when it is actually behind — which never happens in a
  // test. So what is pinned here is the property the deferral could plausibly
  // break: that an edit still reaches the preview at all, and that the value
  // arriving is the current one rather than a stale snapshot.
  describe("preview content propagation", () => {
    const previewConfig: FormatConfig = {
      ...jsonStub,
      genericPreview: GenericPreview,
    };

    it("hands the preview the document's current content", async () => {
      useDocumentStore.getState().initDocument("tab-defer", "first", "/a.json");

      render(<SplitPaneEditor tabId="tab-defer" formatConfig={previewConfig} />);

      await screen.findByText("preview:first");
    });

    it("propagates a later edit to the preview", async () => {
      useDocumentStore.getState().initDocument("tab-defer-2", "first", "/b.json");
      render(<SplitPaneEditor tabId="tab-defer-2" formatConfig={previewConfig} />);
      await screen.findByText("preview:first");

      useDocumentStore.getState().setContent("tab-defer-2", "second");

      await screen.findByText("preview:second");
    });

    it("settles on the final value after a burst of edits", async () => {
      useDocumentStore.getState().initDocument("tab-defer-3", "v0", "/c.json");
      render(<SplitPaneEditor tabId="tab-defer-3" formatConfig={previewConfig} />);

      for (let i = 1; i <= 10; i++) {
        useDocumentStore.getState().setContent("tab-defer-3", `v${i}`);
      }

      // Intermediate values may be skipped — the last one may not be.
      await screen.findByText("preview:v10");
    });
  });
});
