// WI-1A.5 — Bootstrap module tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapFormats,
  dispatchEditor,
  getFormatById,
  getSupportedExtensions,
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

  it("registers markdown, txt, and all stubs in one call", () => {
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
