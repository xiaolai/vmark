// WI-4.1 — validate the externally-driven MCP request payload (T2)
import { describe, it, expect } from "vitest";
import { isValidMcpRequestRaw } from "./index";

describe("isValidMcpRequestRaw", () => {
  it("accepts a well-formed request", () => {
    expect(isValidMcpRequestRaw({ id: "req-1", type: "vmark.document.read" })).toBe(true);
    expect(
      isValidMcpRequestRaw({ id: "req-1", type: "x", args_json: "{}" }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    "string",
    42,
    {},
    { id: "req-1" }, // missing type
    { type: "x" }, // missing id
    { id: 1, type: "x" }, // id not a string
    { id: "req-1", type: 2 }, // type not a string
    { id: null, type: null },
  ])("rejects malformed payload %p", (payload) => {
    expect(isValidMcpRequestRaw(payload)).toBe(false);
  });
});
