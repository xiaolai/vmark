// @vitest-environment node
/**
 * Tests for typewriterMode — extension structure and configuration.
 */

import { describe, it, expect } from "vitest";
import { typewriterModeExtension } from "../tiptap";

describe("typewriterModeExtension", () => {
  it("has the correct name", () => {
    expect(typewriterModeExtension.name).toBe("typewriterMode");
  });

  it("is an Extension type", () => {
    expect(typewriterModeExtension.type).toBe("extension");
  });

  it("defines ProseMirror plugins via addProseMirrorPlugins", () => {
    const config = typewriterModeExtension.config;
    expect(config.addProseMirrorPlugins).toBeDefined();
    expect(typeof config.addProseMirrorPlugins).toBe("function");
  });
});
