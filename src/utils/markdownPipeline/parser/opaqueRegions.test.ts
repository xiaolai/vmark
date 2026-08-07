// @vitest-environment node
// Tests for the shared CommonMark code-fence line tracker.

import { describe, it, expect } from "vitest";
import { createCodeFenceTracker } from "./opaqueRegions";

describe("createCodeFenceTracker", () => {
  it("tracks open/close across lines", () => {
    const t = createCodeFenceTracker();
    expect(t.feed("```")).toBe(true);
    expect(t.feed("inside")).toBe(true);
    expect(t.feed("```")).toBe(true);
    expect(t.feed("after")).toBe(false);
  });

  it("requires the closer to match the opener's char and length", () => {
    const t = createCodeFenceTracker();
    expect(t.feed("`````")).toBe(true);
    expect(t.feed("```")).toBe(true); // shorter run: still inside
    expect(t.feed("~~~~~")).toBe(true); // wrong char: still inside
    expect(t.feed("`````")).toBe(true); // closes
    expect(t.feed("after")).toBe(false);
  });

  it("a closer may carry only trailing whitespace (CRLF ok)", () => {
    const t = createCodeFenceTracker();
    expect(t.feed("```")).toBe(true);
    expect(t.feed("``` x")).toBe(true); // trailing text: content
    expect(t.feed("```  \r")).toBe(true); // closes
    expect(t.feed("after")).toBe(false);
  });

  it("rejects a backtick opener whose info string contains a backtick", () => {
    const t = createCodeFenceTracker();
    expect(t.feed("```foo`")).toBe(false);
    expect(t.feed("not code")).toBe(false);
  });
});
