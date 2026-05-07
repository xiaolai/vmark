// WI-1A.5 — Bootstrap module tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapFormats,
  dispatchEditor,
  getFormatById,
  getSupportedExtensions,
  rebootstrapFormats,
  __resetBootstrap,
} from "./index";
import { __resetRegistry } from "./registry";

describe("bootstrapFormats", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });
  afterEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });

  it("registers markdown, txt, and every Phase 2-4 adapter in one call", () => {
    bootstrapFormats();
    expect(getFormatById("markdown")).toBeDefined();
    expect(getFormatById("txt")).toBeDefined();
    expect(getFormatById("json")).toBeDefined();
    expect(getFormatById("yaml")).toBeDefined();
    expect(getFormatById("toml")).toBeDefined();
    expect(getFormatById("html")).toBeDefined();
    expect(getFormatById("svg")).toBeDefined();
    expect(getFormatById("mermaid")).toBeDefined();
    expect(getFormatById("code-typescript")).toBeDefined();
    expect(getFormatById("code-rust")).toBeDefined();
  });

  it("getSupportedExtensions returns >= 14 extensions after bootstrap", () => {
    bootstrapFormats();
    expect(getSupportedExtensions().length).toBeGreaterThanOrEqual(14);
  });

  it("is idempotent — second call is a no-op", () => {
    bootstrapFormats();
    expect(() => bootstrapFormats()).not.toThrow();
    // Still all formats present
    expect(getFormatById("markdown")).toBeDefined();
  });

  it("dispatches markdown for null path after bootstrap", () => {
    bootstrapFormats();
    expect(dispatchEditor(null).id).toBe("markdown");
  });

  it("dispatches code-typescript for .ts after bootstrap", () => {
    bootstrapFormats();
    expect(dispatchEditor("/x/foo.ts").id).toBe("code-typescript");
  });

  it("__resetBootstrap allows re-registration after registry reset", () => {
    bootstrapFormats();
    __resetRegistry();
    __resetBootstrap();
    expect(() => bootstrapFormats()).not.toThrow();
    expect(getFormatById("markdown")).toBeDefined();
  });
});

describe("bootstrapFormats with opt-in toggles", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });
  afterEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });

  it("with everything off: only markdown, txt, and yaml register", () => {
    bootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
    });
    expect(getFormatById("markdown")).toBeDefined();
    expect(getFormatById("txt")).toBeDefined();
    expect(getFormatById("yaml")).toBeDefined();
    expect(getFormatById("json")).toBeUndefined();
    expect(getFormatById("toml")).toBeUndefined();
    expect(getFormatById("mermaid")).toBeUndefined();
    expect(getFormatById("svg")).toBeUndefined();
    expect(getFormatById("html")).toBeUndefined();
    expect(getFormatById("code-typescript")).toBeUndefined();
  });

  it("dataFormats toggle: only json + toml register (yaml is always-on)", () => {
    bootstrapFormats({
      dataFormats: true,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
    });
    expect(getFormatById("json")).toBeDefined();
    expect(getFormatById("toml")).toBeDefined();
    expect(getFormatById("mermaid")).toBeUndefined();
    expect(getFormatById("html")).toBeUndefined();
    expect(getFormatById("code-typescript")).toBeUndefined();
  });

  it("diagrams toggle: mermaid + svg register, html stays off", () => {
    bootstrapFormats({
      dataFormats: false,
      diagrams: true,
      htmlPreview: false,
      codeViewers: false,
    });
    expect(getFormatById("mermaid")).toBeDefined();
    expect(getFormatById("svg")).toBeDefined();
    expect(getFormatById("html")).toBeUndefined();
  });

  it("htmlPreview toggle: html registers, others stay off", () => {
    bootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: true,
      codeViewers: false,
    });
    expect(getFormatById("html")).toBeDefined();
    expect(getFormatById("mermaid")).toBeUndefined();
  });

  it("codeViewers toggle: every code-* format registers", () => {
    bootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: true,
    });
    expect(getFormatById("code-typescript")).toBeDefined();
    expect(getFormatById("code-python")).toBeDefined();
    expect(getFormatById("code-rust")).toBeDefined();
  });

  it("yaml is registered even with everything off (always-on contract)", () => {
    // Regression: previous release shipped GHA workflow viewer ON for
    // all users. Reverting yaml on upgrade would break that contract.
    bootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
    });
    const yamlFormat = getFormatById("yaml");
    expect(yamlFormat).toBeDefined();
    expect(yamlFormat?.kind).toBe("split-pane");
  });

  it("unknown extension falls back to txt when its category is off", () => {
    // .json with dataFormats=false should dispatch to the txt fallback
    // (registered by the always-on trio), not throw.
    bootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
    });
    expect(dispatchEditor("/x/data.json").id).toBe("txt");
    expect(dispatchEditor("/x/page.html").id).toBe("txt");
    expect(dispatchEditor("/x/script.ts").id).toBe("txt");
  });
});

describe("rebootstrapFormats", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });
  afterEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });

  it("rebuilds the registry with new toggles", () => {
    bootstrapFormats({
      dataFormats: true,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
    });
    expect(getFormatById("json")).toBeDefined();
    expect(getFormatById("html")).toBeUndefined();

    rebootstrapFormats({
      dataFormats: false,
      diagrams: false,
      htmlPreview: true,
      codeViewers: false,
    });
    expect(getFormatById("json")).toBeUndefined();
    expect(getFormatById("html")).toBeDefined();
    // Always-on trio survives every rebootstrap.
    expect(getFormatById("markdown")).toBeDefined();
    expect(getFormatById("yaml")).toBeDefined();
    expect(getFormatById("txt")).toBeDefined();
  });
});
