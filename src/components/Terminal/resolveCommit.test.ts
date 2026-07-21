import { describe, it, expect } from "vitest";
import { resolveCommit } from "./resolveCommit";

describe("resolveCommit", () => {
  it("commits real non-ASCII eventData directly (你好, single CJK)", () => {
    expect(resolveCommit({ eventData: "你好", textareaDiff: "你好" })).toBe("你好");
    expect(resolveCommit({ eventData: "。", textareaDiff: "。" })).toBe("。");
  });

  it("trusts the textarea diff when eventData is the ASCII key but the diff is CJK", () => {
    // macOS Pinyin punctuation: e.data="?" but textarea has "？".
    expect(resolveCommit({ eventData: "?", textareaDiff: "？" })).toBe("？");
    expect(resolveCommit({ eventData: ",", textareaDiff: "，" })).toBe("，");
    expect(resolveCommit({ eventData: "--", textareaDiff: "——" })).toBe("——");
  });

  it("trusts the textarea diff when eventData is empty but the diff is CJK", () => {
    expect(resolveCommit({ eventData: "", textareaDiff: "？" })).toBe("？");
    expect(resolveCommit({ eventData: null, textareaDiff: "。" })).toBe("。");
  });

  it("returns null for pure-ASCII with no non-ASCII diff (xterm keydown owns ASCII)", () => {
    expect(resolveCommit({ eventData: "?", textareaDiff: "?" })).toBeNull();
    expect(resolveCommit({ eventData: "a", textareaDiff: "a" })).toBeNull();
    expect(resolveCommit({ eventData: "", textareaDiff: "" })).toBeNull();
    expect(resolveCommit({ eventData: null, textareaDiff: "" })).toBeNull();
  });

  it("prefers real non-ASCII eventData over the diff", () => {
    // If e.data already carries the CJK char, use it (diff is corroborating).
    expect(resolveCommit({ eventData: "你", textareaDiff: "你" })).toBe("你");
  });
});
