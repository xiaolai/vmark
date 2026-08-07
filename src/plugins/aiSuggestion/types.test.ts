// @vitest-environment node
import { describe, it, expect } from "vitest";
import { requireSuggestionStore } from "./types";

describe("requireSuggestionStore", () => {
  it("returns the store it was given", () => {
    const store = { getState: () => ({}), subscribe: () => () => {} } as never;
    expect(requireSuggestionStore(store)).toBe(store);
  });

  it("throws a message naming the fix when nothing was wired", () => {
    // A port gets no default: an unwired extension that renders suggestions
    // but drops every accept would look like a model bug and be debugged in
    // the wrong place. The message has to point at the wiring.
    expect(() => requireSuggestionStore(null)).toThrow(/requires a `store` option/);
  });
});
