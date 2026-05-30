// Tests for jsonViewStyles — the token-aligned react-json-view-lite style
// builder shared by the json / yaml / toml tree previews.

import { describe, it, expect } from "vitest";
import { defaultStyles, darkStyles } from "react-json-view-lite";
import { jsonViewStyles } from "./jsonViewStyles";

describe("jsonViewStyles", () => {
  it("overrides value/key/punctuation classes with the token-aligned names", () => {
    const s = jsonViewStyles(false);
    expect(s.label).toBe("vmark-json-view__key");
    expect(s.stringValue).toBe("vmark-json-view__string");
    expect(s.numberValue).toBe("vmark-json-view__number");
    expect(s.otherValue).toBe("vmark-json-view__other");
    expect(s.punctuation).toBe("vmark-json-view__punctuation");
  });

  it("maps boolean / null / undefined to the number color (matches theme.ts)", () => {
    const s = jsonViewStyles(false);
    expect(s.booleanValue).toBe("vmark-json-view__number");
    expect(s.nullValue).toBe("vmark-json-view__number");
    expect(s.undefinedValue).toBe("vmark-json-view__number");
  });

  it("keeps the library's structural container class and adds our bg-neutralizing class", () => {
    const light = jsonViewStyles(false);
    expect(light.container).toContain(defaultStyles.container);
    expect(light.container).toContain("vmark-json-view__container");
    const dark = jsonViewStyles(true);
    expect(dark.container).toContain(darkStyles.container);
    expect(dark.container).toContain("vmark-json-view__container");
  });

  it("combines the library's clickable affordance class with our color class", () => {
    const light = jsonViewStyles(false);
    expect(light.clickableLabel).toContain(defaultStyles.clickableLabel);
    expect(light.clickableLabel).toContain("vmark-json-view__key");

    const dark = jsonViewStyles(true);
    expect(dark.clickableLabel).toContain(darkStyles.clickableLabel);
  });
});
