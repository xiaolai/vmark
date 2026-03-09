import { describe, it, expect } from "vitest";
import { requireString, optionalString, optionalNumber, optionalBoolean, numberWithDefault, booleanWithDefault, stringWithDefault, requireEnum, requireArray } from "./validateArgs";

describe("requireString", () => {
  it.each([
    { args: { key: "hello" }, expected: "hello" },
    { args: { key: "" }, expected: "" },
    { args: { key: "with spaces" }, expected: "with spaces" },
  ])("returns $expected for valid string", ({ args, expected }) => {
    expect(requireString(args, "key")).toBe(expected);
  });

  it("throws for missing key", () => {
    expect(() => requireString({}, "key")).toThrow("Missing or invalid 'key'");
  });

  it("throws for undefined value", () => {
    expect(() => requireString({ key: undefined }, "key")).toThrow("expected string, got undefined");
  });

  it("throws for null value", () => {
    expect(() => requireString({ key: null }, "key")).toThrow("expected string, got object");
  });

  it("throws for number value", () => {
    expect(() => requireString({ key: 42 }, "key")).toThrow("expected string, got number");
  });

  it("throws for boolean value", () => {
    expect(() => requireString({ key: true }, "key")).toThrow("expected string, got boolean");
  });
});

describe("optionalString", () => {
  it("returns string when present", () => {
    expect(optionalString({ key: "value" }, "key")).toBe("value");
  });

  it("returns empty string when present", () => {
    expect(optionalString({ key: "" }, "key")).toBe("");
  });

  it("returns undefined for missing key", () => {
    expect(optionalString({}, "key")).toBeUndefined();
  });

  it("returns undefined for undefined value", () => {
    expect(optionalString({ key: undefined }, "key")).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(optionalString({ key: null }, "key")).toBeUndefined();
  });

  it("throws for non-string value", () => {
    expect(() => optionalString({ key: 42 }, "key")).toThrow("expected string, got number");
  });
});

describe("optionalNumber", () => {
  it("returns number when present", () => {
    expect(optionalNumber({ key: 42 }, "key")).toBe(42);
  });

  it("returns 0 when present", () => {
    expect(optionalNumber({ key: 0 }, "key")).toBe(0);
  });

  it("returns NaN when passed NaN", () => {
    expect(optionalNumber({ key: NaN }, "key")).toBeNaN();
  });

  it("returns undefined for missing key", () => {
    expect(optionalNumber({}, "key")).toBeUndefined();
  });

  it("returns undefined for undefined value", () => {
    expect(optionalNumber({ key: undefined }, "key")).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(optionalNumber({ key: null }, "key")).toBeUndefined();
  });

  it("throws for non-number value", () => {
    expect(() => optionalNumber({ key: "42" }, "key")).toThrow("expected number, got string");
  });
});

describe("optionalBoolean", () => {
  it("returns boolean when present", () => {
    expect(optionalBoolean({ key: true }, "key")).toBe(true);
    expect(optionalBoolean({ key: false }, "key")).toBe(false);
  });

  it("returns undefined for missing key", () => {
    expect(optionalBoolean({}, "key")).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(optionalBoolean({ key: null }, "key")).toBeUndefined();
  });

  it("throws for non-boolean value", () => {
    expect(() => optionalBoolean({ key: "true" }, "key")).toThrow("expected boolean, got string");
  });
});

describe("numberWithDefault", () => {
  it("returns number when present", () => {
    expect(numberWithDefault({ key: 42 }, "key", 0)).toBe(42);
  });

  it("returns 0 when present (not default)", () => {
    expect(numberWithDefault({ key: 0 }, "key", 100)).toBe(0);
  });

  it("returns default for missing key", () => {
    expect(numberWithDefault({}, "key", 100)).toBe(100);
  });

  it("returns default for null value", () => {
    expect(numberWithDefault({ key: null }, "key", 100)).toBe(100);
  });

  it("throws for non-number value", () => {
    expect(() => numberWithDefault({ key: "42" }, "key", 0)).toThrow("expected number, got string");
  });
});

describe("booleanWithDefault", () => {
  it("returns boolean when present", () => {
    expect(booleanWithDefault({ key: true }, "key", false)).toBe(true);
    expect(booleanWithDefault({ key: false }, "key", true)).toBe(false);
  });

  it("returns default for missing key", () => {
    expect(booleanWithDefault({}, "key", true)).toBe(true);
  });

  it("returns default for null value", () => {
    expect(booleanWithDefault({ key: null }, "key", false)).toBe(false);
  });

  it("throws for non-boolean value", () => {
    expect(() => booleanWithDefault({ key: "true" }, "key", false)).toThrow("expected boolean, got string");
  });
});

describe("stringWithDefault", () => {
  it("returns string when present", () => {
    expect(stringWithDefault({ key: "value" }, "key", "default")).toBe("value");
  });

  it("returns empty string when present (not default)", () => {
    expect(stringWithDefault({ key: "" }, "key", "default")).toBe("");
  });

  it("returns default for missing key", () => {
    expect(stringWithDefault({}, "key", "fallback")).toBe("fallback");
  });

  it("returns default for undefined value", () => {
    expect(stringWithDefault({ key: undefined }, "key", "fallback")).toBe("fallback");
  });

  it("returns default for null value", () => {
    expect(stringWithDefault({ key: null }, "key", "fallback")).toBe("fallback");
  });

  it("throws for non-string value", () => {
    expect(() => stringWithDefault({ key: 123 }, "key", "default")).toThrow("expected string, got number");
  });
});

describe("requireEnum", () => {
  const allowed = ["apply", "suggest", "dryRun"] as const;

  it("returns valid enum value", () => {
    expect(requireEnum({ mode: "apply" }, "mode", allowed)).toBe("apply");
    expect(requireEnum({ mode: "suggest" }, "mode", allowed)).toBe("suggest");
    expect(requireEnum({ mode: "dryRun" }, "mode", allowed)).toBe("dryRun");
  });

  it("returns default when key is missing", () => {
    expect(requireEnum({}, "mode", allowed, "apply")).toBe("apply");
  });

  it("returns default when value is null", () => {
    expect(requireEnum({ mode: null }, "mode", allowed, "apply")).toBe("apply");
  });

  it("returns default when value is undefined", () => {
    expect(requireEnum({ mode: undefined }, "mode", allowed, "apply")).toBe("apply");
  });

  it("throws for invalid enum value", () => {
    expect(() => requireEnum({ mode: "invalid" }, "mode", allowed)).toThrow(
      'Invalid \'mode\': "invalid". Must be one of: apply, suggest, dryRun'
    );
  });

  it("throws for non-string value without default", () => {
    expect(() => requireEnum({ mode: 42 }, "mode", allowed)).toThrow(
      "expected one of: apply, suggest, dryRun; got number"
    );
  });

  it("throws for missing key without default", () => {
    expect(() => requireEnum({}, "mode", allowed)).toThrow("got undefined");
  });

  it("throws for invalid value even when default exists", () => {
    expect(() => requireEnum({ mode: "bad" }, "mode", allowed, "apply")).toThrow(
      'Invalid \'mode\': "bad"'
    );
  });
});

describe("requireArray", () => {
  it("returns array when present", () => {
    expect(requireArray({ items: [1, 2, 3] }, "items")).toEqual([1, 2, 3]);
  });

  it("returns empty array", () => {
    expect(requireArray({ items: [] }, "items")).toEqual([]);
  });

  it("throws for missing key", () => {
    expect(() => requireArray({}, "items")).toThrow("expected array, got undefined");
  });

  it("throws for string value", () => {
    expect(() => requireArray({ items: "hello" }, "items")).toThrow("expected array, got string");
  });

  it("throws for number value", () => {
    expect(() => requireArray({ items: 42 }, "items")).toThrow("expected array, got number");
  });

  it("throws for null value", () => {
    expect(() => requireArray({ items: null }, "items")).toThrow("expected array, got object");
  });

  it("applies element validator to each item", () => {
    const result = requireArray({ items: ["a", "b"] }, "items", (el, _i) => {
      if (typeof el !== "string") throw new Error("not a string");
      return el.toUpperCase();
    });
    expect(result).toEqual(["A", "B"]);
  });

  it("element validator throws on invalid element", () => {
    expect(() =>
      requireArray({ items: ["a", 42] }, "items", (el) => {
        if (typeof el !== "string") throw new Error("element must be a string");
        return el;
      })
    ).toThrow("element must be a string");
  });
});
