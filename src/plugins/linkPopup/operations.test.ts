// @vitest-environment node
import { describe, it, expect } from "vitest";

import { classifyLinkAction } from "./operations";

describe("classifyLinkAction", () => {
  it("classifies a fragment href", () => {
    expect(classifyLinkAction("#intro")).toEqual({
      kind: "fragment",
      targetId: "intro",
    });
  });
  it("classifies an external URL", () => {
    expect(classifyLinkAction("https://example.com")).toEqual({ kind: "external" });
  });
  it("classifies a relative filepath", () => {
    expect(classifyLinkAction("./notes.md")).toEqual({ kind: "filepath" });
  });
});
