import { describe, it, expect } from "vitest";
import { requireString, optionalString, optionalNumber, optionalBoolean, numberWithDefault, booleanWithDefault, stringWithDefault, requireEnum, requireObject, requireArray, optionalObject, optionalArray } from "./validateArgs";

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

describe("requireObject", () => {
  it("returns object when present and valid", () => {
    const obj = { a: 1, b: "two" };
    expect(requireObject({ data: obj }, "data")).toEqual(obj);
  });

  it("returns empty object", () => {
    expect(requireObject({ data: {} }, "data")).toEqual({});
  });

  it("throws for missing key", () => {
    expect(() => requireObject({}, "data")).toThrow("Missing or invalid 'data' (expected object, got undefined)");
  });

  it("throws for undefined value", () => {
    expect(() => requireObject({ data: undefined }, "data")).toThrow("expected object, got undefined");
  });

  it("throws for null value", () => {
    expect(() => requireObject({ data: null }, "data")).toThrow("expected object, got null)");
  });

  it("throws for string value", () => {
    expect(() => requireObject({ data: "hello" }, "data")).toThrow("expected object, got string");
  });

  it("throws for number value", () => {
    expect(() => requireObject({ data: 42 }, "data")).toThrow("expected object, got number");
  });

  it("throws for boolean value", () => {
    expect(() => requireObject({ data: true }, "data")).toThrow("expected object, got boolean");
  });

  it("throws for array value (arrays are not plain objects)", () => {
    expect(() => requireObject({ data: [1, 2] }, "data")).toThrow("expected object, got array)");
  });

  it("validates required keys when provided", () => {
    const obj = { name: "test", level: 1 };
    expect(requireObject({ data: obj }, "data", ["name", "level"])).toEqual(obj);
  });

  it("throws when a required key is missing", () => {
    const obj = { name: "test" };
    expect(() => requireObject({ data: obj }, "data", ["name", "level"])).toThrow(
      "Missing required field 'data.level'"
    );
  });

  it("throws for first missing required key when multiple are missing", () => {
    expect(() => requireObject({ data: {} }, "data", ["foo", "bar"])).toThrow(
      "Missing required field 'data.foo'"
    );
  });
});

describe("requireArray", () => {
  it("returns array when present and valid", () => {
    const arr = [1, "two", { three: 3 }];
    expect(requireArray({ items: arr }, "items")).toEqual(arr);
  });

  it("returns empty array", () => {
    expect(requireArray({ items: [] }, "items")).toEqual([]);
  });

  it("throws for missing key", () => {
    expect(() => requireArray({}, "items")).toThrow("Missing or invalid 'items' (expected array, got undefined)");
  });

  it("throws for undefined value", () => {
    expect(() => requireArray({ items: undefined }, "items")).toThrow("expected array, got undefined");
  });

  it("throws for null value", () => {
    expect(() => requireArray({ items: null }, "items")).toThrow("expected array, got null)");
  });

  it("throws for string value", () => {
    expect(() => requireArray({ items: "hello" }, "items")).toThrow("expected array, got string");
  });

  it("throws for number value", () => {
    expect(() => requireArray({ items: 42 }, "items")).toThrow("expected array, got number");
  });

  it("throws for plain object value", () => {
    expect(() => requireArray({ items: { a: 1 } }, "items")).toThrow("expected array, got object");
  });
});

describe("optionalObject", () => {
  it("returns object when present and valid", () => {
    const obj = { a: 1 };
    expect(optionalObject({ data: obj }, "data")).toEqual(obj);
  });

  it("returns undefined for missing key", () => {
    expect(optionalObject({}, "data")).toBeUndefined();
  });

  it("returns undefined for undefined value", () => {
    expect(optionalObject({ data: undefined }, "data")).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(optionalObject({ data: null }, "data")).toBeUndefined();
  });

  it("throws for non-object value", () => {
    expect(() => optionalObject({ data: "hello" }, "data")).toThrow("expected object, got string");
  });

  it("throws for array value", () => {
    expect(() => optionalObject({ data: [1] }, "data")).toThrow("expected object, got array)");
  });
});

describe("optionalArray", () => {
  it("returns array when present and valid", () => {
    expect(optionalArray({ items: [1, 2] }, "items")).toEqual([1, 2]);
  });

  it("returns undefined for missing key", () => {
    expect(optionalArray({}, "items")).toBeUndefined();
  });

  it("returns undefined for undefined value", () => {
    expect(optionalArray({ items: undefined }, "items")).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(optionalArray({ items: null }, "items")).toBeUndefined();
  });

  it("throws for non-array value", () => {
    expect(() => optionalArray({ items: "hello" }, "items")).toThrow("expected array, got string");
  });

  it("throws for plain object value", () => {
    expect(() => optionalArray({ items: { a: 1 } }, "items")).toThrow("expected array, got object");
  });
});

describe("requireEnum", () => {
  const allowed = ["apply", "suggest", "dryRun"] as const;

  it("returns value when it is in the allowed set", () => {
    expect(requireEnum({ mode: "apply" }, "mode", allowed)).toBe("apply");
    expect(requireEnum({ mode: "suggest" }, "mode", allowed)).toBe("suggest");
    expect(requireEnum({ mode: "dryRun" }, "mode", allowed)).toBe("dryRun");
  });

  it("returns default when key is missing", () => {
    expect(requireEnum({}, "mode", allowed, "apply")).toBe("apply");
  });

  it("returns default when value is undefined", () => {
    expect(requireEnum({ mode: undefined }, "mode", allowed, "apply")).toBe("apply");
  });

  it("returns default when value is null", () => {
    expect(requireEnum({ mode: null }, "mode", allowed, "apply")).toBe("apply");
  });

  it("throws for value not in allowed set", () => {
    expect(() => requireEnum({ mode: "invalid" }, "mode", allowed)).toThrow(
      'Invalid mode: "invalid". Must be one of: apply, suggest, dryRun'
    );
  });

  it("throws for non-string value", () => {
    expect(() => requireEnum({ mode: 42 }, "mode", allowed)).toThrow("expected string, got number");
  });

  it("throws when missing with no default", () => {
    expect(() => requireEnum({}, "mode", allowed)).toThrow("expected string, got undefined");
  });
});
