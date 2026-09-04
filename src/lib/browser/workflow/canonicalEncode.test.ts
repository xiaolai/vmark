// @vitest-environment node
// WI-4.2 / R8 — canonical value encoding: the collision-averse text form behind
// idempotency keys and the workflow IR hash. Split out of safety.ts (audit r3 #140)
// so primitive encoding, object-kind validation and the recursive composer are
// each pinned on their own.
import { describe, expect, it } from "vitest";
import { classifyObject, encodeCanonical, encodePrimitive, isPrimitive, sortedDataKeys } from "./canonicalEncode";
import { idempotencyKey } from "./safety";

describe("isPrimitive", () => {
  it("accepts exactly the encodable primitive kinds", () => {
    for (const v of [null, undefined, true, false, 0, -0, NaN, 1n, "", "s"]) expect(isPrimitive(v), String(v)).toBe(true);
  });

  it("rejects objects, functions and symbols", () => {
    const rejected: unknown[] = [{}, [], new Date(), new Map(), () => 1, Symbol("x"), Object.create(null)];
    for (const v of rejected) expect(isPrimitive(v)).toBe(false);
  });
});

describe("encodePrimitive", () => {
  it.each([
    [null, "null"],
    [undefined, "undefined"],
    [true, "true"],
    [false, "false"],
    [0, "0"],
    [-0, "-0"],
    [1.5, "1.5"],
    [-3, "-3"],
    [NaN, "#NaN"],
    [Infinity, "#Infinity"],
    [-Infinity, "#-Infinity"],
    [1n, "1n"],
    [-7n, "-7n"],
    ["", '""'],
    ["null", '"null"'],
    ['say "hi"', '"say \\"hi\\""'],
  ])("encodes %s as %s", (value, text) => {
    expect(encodePrimitive(value)).toBe(text);
  });

  it("gives every distinct primitive a distinct text (JSON.stringify merges several of these)", () => {
    const values = [null, undefined, NaN, Infinity, -Infinity, 0, -0, 1, 1n, "1", "1n", "null", "undefined", "#NaN", "", true, false, "true"];
    expect(new Set(values.map(encodePrimitive)).size).toBe(values.length);
  });
});

describe("classifyObject", () => {
  it("classifies the three encodable kinds", () => {
    expect(classifyObject({})).toBe("plain");
    expect(classifyObject(Object.create(null) as object)).toBe("plain");
    expect(classifyObject([])).toBe("array");
    expect(classifyObject(Array(2))).toBe("array"); // a hole is fine — the composer encodes it distinctly
    expect(classifyObject(new Date(0))).toBe("date");
    expect(classifyObject(new Date(NaN))).toBe("date");
  });

  it("refuses every object whose full state cannot be read off its own keys", () => {
    class Thing {
      x = 1;
    }
    class MyArray extends Array {}
    class MyDate extends Date {}
    const symbolArray: unknown[] = [1];
    (symbolArray as unknown as Record<symbol, number>)[Symbol("k")] = 2;
    const extraArray: unknown[] = [1];
    Object.defineProperty(extraArray, "extra", { value: 1, enumerable: false });
    const taggedDate = new Date(0);
    (taggedDate as unknown as { extra: number }).extra = 1;
    const cases: Array<[string, object]> = [
      ["Map", new Map()],
      ["Set", new Set()],
      ["class instance", new Thing()],
      ["RegExp", /x/],
      ["Promise", Promise.resolve()],
      ["Array subclass", new MyArray()],
      ["Date subclass", new MyDate(0)],
      ["array with a symbol key", symbolArray],
      ["array with a non-index property", extraArray],
      ["Date with own properties", taggedDate],
      ["object with a non-Object prototype", Object.create(Object.create(null)) as object],
    ];
    for (const [label, value] of cases) expect(() => classifyObject(value), label).toThrow(TypeError);
  });

  it("names the refused constructor in the error", () => {
    expect(() => classifyObject(new Map())).toThrow(/Map/);
    class Widget {}
    expect(() => classifyObject(new Widget())).toThrow(/Widget/);
  });
});

describe("sortedDataKeys", () => {
  it("returns the own string keys sorted, including non-enumerable data properties", () => {
    const o: Record<string, unknown> = { b: 1, a: 2 };
    Object.defineProperty(o, "hidden", { value: 3, enumerable: false });
    expect(sortedDataKeys(o)).toEqual(["a", "b", "hidden"]);
    expect(sortedDataKeys({})).toEqual([]);
    expect(sortedDataKeys(Object.create(null) as object)).toEqual([]);
  });

  it("is insertion-order independent", () => {
    expect(sortedDataKeys({ x: 1, y: 2, z: 3 })).toEqual(sortedDataKeys({ z: 3, y: 2, x: 1 }));
  });

  it("rejects symbol keys and accessor properties (getter OR setter)", () => {
    expect(() => sortedDataKeys({ [Symbol("k")]: 1 })).toThrow(TypeError);
    const getter: Record<string, unknown> = {};
    Object.defineProperty(getter, "g", { get: () => 1, enumerable: true });
    expect(() => sortedDataKeys(getter)).toThrow(TypeError);
    const setter: Record<string, unknown> = {};
    Object.defineProperty(setter, "s", { set: () => undefined, enumerable: true });
    expect(() => sortedDataKeys(setter)).toThrow(TypeError);
  });
});

describe("encodeCanonical", () => {
  it("composes primitives, arrays, dates and plain objects into one unambiguous text", () => {
    const value = { b: [1, { c: null }, "x,y"], a: "x", d: new Date("2026-01-01T00:00:00Z"), u: undefined };
    expect(encodeCanonical(value)).toBe('{"a":"x","b":[1,{"c":null},"x,y"],"d":Date(2026-01-01T00:00:00.000Z),"u":undefined}');
  });

  it("is key-order independent and encodes an invalid Date and a hole distinctly", () => {
    expect(encodeCanonical({ a: 1, b: 2 })).toBe(encodeCanonical({ b: 2, a: 1 }));
    expect(encodeCanonical(new Date(NaN))).toBe("Date(invalid)");
    expect(encodeCanonical(Array(2))).toBe("[#hole,#hole]");
    expect(encodeCanonical([undefined, undefined])).toBe("[undefined,undefined]");
  });

  it("keeps its delimiters unambiguous — a string containing the syntax cannot forge structure", () => {
    expect(encodeCanonical({ a: '","b":1' })).not.toBe(encodeCanonical({ a: "", b: 1 }));
  });

  it("does not mistake a shared reference for a cycle", () => {
    const shared = { k: 1 };
    expect(encodeCanonical({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });

  it("fails closed on a cycle, past the depth bound, and on an unencodable leaf anywhere in the tree", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => encodeCanonical(cyclic)).toThrow(/cyclic/);
    const ring: unknown[] = [];
    ring.push({ ring });
    expect(() => encodeCanonical(ring)).toThrow(/cyclic/);

    const wrap = (levels: number): unknown => {
      let v: unknown = 1;
      for (let i = 0; i < levels; i++) v = [v];
      return v;
    };
    expect(() => encodeCanonical(wrap(100))).not.toThrow();
    expect(() => encodeCanonical(wrap(101))).toThrow(/deeper/);

    expect(() => encodeCanonical({ list: [new Set()] })).toThrow(TypeError);
    expect(() => encodeCanonical([() => 1])).toThrow(TypeError);
    expect(() => encodeCanonical(Symbol("x"))).toThrow(TypeError);
  });
});

describe("idempotencyKey composes on encodeCanonical", () => {
  it("is the step id, a colon, then the canonical encoding of the inputs", () => {
    const inputs = { title: "Hi", tags: ["a", "b"] };
    expect(idempotencyKey("publish", inputs)).toBe(`publish:${encodeCanonical(inputs)}`);
  });
});

describe("array elements must be data properties (round 3)", () => {
  it("refuses an array whose index is an accessor instead of invoking the getter", () => {
    const arr: unknown[] = [1];
    let reads = 0;
    Object.defineProperty(arr, 1, {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 2;
      },
    });
    expect(() => encodeCanonical({ a: arr })).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
