// WI-AL2.1a — The message protocol between the budgeted diff and its worker: a request is answered with the exact canonical changes or a failed reply carrying the reason, never a throw across the boundary; replies are validated on receipt, and anything malformed is refused as null.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleDiffRequest, parseDiffReply } from "../diffProtocol";

describe("handleDiffRequest", () => {
  it("answers with the exact canonical changes", () => {
    expect(handleDiffRequest({ type: "diff", id: 7, a: "a😀b", b: "a😁b" })).toEqual({
      type: "result",
      id: 7,
      changes: [{ fromA: 1, toA: 3, fromB: 1, toB: 3 }],
    });
  });

  it("turns a failure into a failed reply with its message", () => {
    expect(handleDiffRequest({ type: "diff", id: 3, a: "a\uD83D", b: "a" })).toMatchObject({
      type: "failed",
      id: 3,
      message: expect.stringMatching(/INVALID_TEXT|surrogate|well-formed/i),
    });
  });

  it.each([null, "diff", { type: "diff", id: "1", a: "", b: "" }, { type: "diff", id: 1, a: 1, b: "" }, { type: "other" }])(
    "a malformed request %j is a failed reply, not a throw",
    (request) => {
      expect(handleDiffRequest(request)).toMatchObject({ type: "failed" });
    },
  );
});

describe("parseDiffReply", () => {
  it.each([
    [{ type: "ready" }],
    [{ type: "result", id: 1, changes: [] }],
    [{ type: "result", id: 1, changes: [{ fromA: 0, toA: 1, fromB: 0, toB: 2 }] }],
    [{ type: "failed", id: 2, message: "x" }],
  ])("accepts %j", (reply) => {
    expect(parseDiffReply(reply)).toEqual(reply);
  });

  it.each([
    null,
    42,
    { type: "result", id: 1 },
    { type: "result", id: 1, changes: "nope" },
    { type: "result", id: 1, changes: [{ fromA: 0, toA: 1, fromB: 0 }] },
    { type: "result", id: 1, changes: [{ fromA: -1, toA: 1, fromB: 0, toB: 1 }] },
    { type: "result", id: 1, changes: [{ fromA: 0.5, toA: 1, fromB: 0, toB: 1 }] },
    { type: "failed", id: 1 },
    { type: "surprise" },
  ])("refuses %j", (reply) => {
    expect(parseDiffReply(reply)).toBeNull();
  });
});
