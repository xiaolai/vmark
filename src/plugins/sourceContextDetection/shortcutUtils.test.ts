import { describe, it, expect } from "vitest";
import { resolveSourceFormatShortcut } from "./shortcutUtils";
import { FORMAT_MARKERS } from "./formatTypes";

describe("resolveSourceFormatShortcut", () => {
  it("maps common keys to format actions", () => {
    expect(resolveSourceFormatShortcut("b")).toBe("bold");
    expect(resolveSourceFormatShortcut("i")).toBe("italic");
    expect(resolveSourceFormatShortcut("k")).toBe("link");
    expect(resolveSourceFormatShortcut("`")).toBe("code");
  });

  it("maps u to underline", () => {
    expect(resolveSourceFormatShortcut("u")).toBe("underline");
  });

  it("returns null for unsupported keys", () => {
    expect(resolveSourceFormatShortcut("x")).toBeNull();
  });
});

describe("FORMAT_MARKERS", () => {
  it("includes underline with ++ markers", () => {
    const underline = FORMAT_MARKERS.underline;
    expect(underline).toBeDefined();
    expect(underline.prefix).toBe("++");
    expect(underline.suffix).toBe("++");
  });
});
