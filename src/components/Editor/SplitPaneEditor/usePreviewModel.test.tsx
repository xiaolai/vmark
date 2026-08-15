// usePreviewModel — one coherent snapshot for the preview pane.
//
// jsdom, not node: `renderHook` mounts into a real document.
//
// The defect this exists to kill: renderer selection and preview diagnostics
// were derived from the CURRENT content while the renderer itself was handed
// DEFERRED content. A schema-changing edit could therefore mount the new
// schema's renderer with the previous document, annotated with diagnostics
// from a third revision.

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormatConfig, ValidationDiagnostic } from "@/lib/formats/types";
import { usePreviewModel } from "./usePreviewModel";

const GenericPreview = () => null;
const SchemaA = () => null;
const SchemaB = () => null;

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [],
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

function config(over: Partial<FormatConfig> = {}): FormatConfig {
  return {
    id: "json",
    nameI18nKey: "format.json",
    extensions: ["json"],
    kind: "split-pane",
    adapters: baseAdapters,
    ...over,
  };
}

function model(args: Parameters<typeof usePreviewModel>[0]) {
  return renderHook((a: Parameters<typeof usePreviewModel>[0]) => usePreviewModel(a), {
    initialProps: args,
  });
}

describe("renderer selection", () => {
  it("uses the generic preview when no schema renderers exist", () => {
    const { result } = model({
      formatConfig: config({ genericPreview: GenericPreview }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.Preview).toBe(GenericPreview);
    expect(result.current.hasPreview).toBe(true);
  });

  it("has no preview when the format declares none", () => {
    const { result } = model({
      formatConfig: config(),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.Preview).toBeUndefined();
    expect(result.current.hasPreview).toBe(false);
  });

  it("prefers an explicit activeSchemaId over the detector", () => {
    const { result } = model({
      formatConfig: config({
        genericPreview: GenericPreview,
        schemaRenderers: { a: SchemaA, b: SchemaB },
        schemaDetector: () => "a",
      }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: "b",
    });
    expect(result.current.Preview).toBe(SchemaB);
  });

  it("falls back to the detector when the explicit pick is unregistered", () => {
    const { result } = model({
      formatConfig: config({
        genericPreview: GenericPreview,
        schemaRenderers: { a: SchemaA },
        schemaDetector: () => "a",
      }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: "gone",
    });
    expect(result.current.Preview).toBe(SchemaA);
  });

  it("falls back to the generic preview when the detector throws", () => {
    const { result } = model({
      formatConfig: config({
        genericPreview: GenericPreview,
        schemaRenderers: { a: SchemaA },
        schemaDetector: () => {
          throw new Error("boom");
        },
      }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.Preview).toBe(GenericPreview);
  });
});

describe("snapshot coherence", () => {
  /// The renderer must be chosen from the SAME content it will be handed.
  it("detects the schema from the content the renderer receives", () => {
    const seen: string[] = [];
    const { result } = model({
      formatConfig: config({
        genericPreview: GenericPreview,
        schemaRenderers: { a: SchemaA },
        schemaDetector: (_p, c) => {
          seen.push(c);
          return c.includes("marker") ? "a" : null;
        },
      }),
      content: "marker",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.Preview).toBe(SchemaA);
    expect(seen).toContain(result.current.content);
  });

  it("validates the content the renderer receives", () => {
    const validator = vi.fn(
      (c: string): ValidationDiagnostic[] =>
        c.includes("bad")
          ? [{ severity: "error", line: 1, column: 1, message: "bad" }]
          : [],
    );
    const { result } = model({
      formatConfig: config({ genericPreview: GenericPreview, validator }),
      content: "bad",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.diagnostics).toHaveLength(1);
    expect(validator).toHaveBeenCalledWith(result.current.content, "/a.json");
  });

  /// Actions must not use the deferred value — publishing what the user can no
  /// longer see is a correctness bug, not a rendering nicety.
  it("exposes the authoritative content separately for actions", () => {
    const { result } = model({
      formatConfig: config({ genericPreview: GenericPreview }),
      content: "live",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.liveContent).toBe("live");
  });

  it("keeps liveContent in step with the document across updates", () => {
    const args = {
      formatConfig: config({ genericPreview: GenericPreview }),
      content: "v1",
      filePath: "/a.json" as string | null,
      activeSchemaId: null as string | null,
    };
    const { result, rerender } = model(args);
    rerender({ ...args, content: "v2" });
    expect(result.current.liveContent).toBe("v2");
  });
});

describe("validator robustness", () => {
  it("returns no diagnostics when the format declares no validator", () => {
    const { result } = model({
      formatConfig: config({ genericPreview: GenericPreview }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.diagnostics).toEqual([]);
  });

  /// It runs during render with no SourcePane to sandbox it, so a buggy
  /// validator must not take the preview surface down.
  it("survives a throwing validator", () => {
    const { result } = model({
      formatConfig: config({
        genericPreview: GenericPreview,
        validator: () => {
          throw new Error("boom");
        },
      }),
      content: "{}",
      filePath: "/a.json",
      activeSchemaId: null,
    });
    expect(result.current.diagnostics).toEqual([]);
  });

  it("passes undefined rather than an empty path for an untitled document", () => {
    const validator = vi.fn(() => []);
    model({
      formatConfig: config({ genericPreview: GenericPreview, validator }),
      content: "{}",
      filePath: null,
      activeSchemaId: null,
    });
    expect(validator).toHaveBeenCalledWith("{}", undefined);
  });
});
