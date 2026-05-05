// WI-B.2 — go-to-def for `uses:` lines in workflow YAML.
// Pure-logic tests; the CM event-handler integration is exercised in
// the live Tauri smoke (no jsdom mouse-event simulation).

import { describe, it, expect } from "vitest";
import { extractUsesAt } from "./sourceWorkflowGoto";

describe("extractUsesAt", () => {
  it("returns the uses ref when cursor is on a uses: line", () => {
    const text = "      - uses: ./.github/actions/setup\n";
    const cursor = text.indexOf("./");
    expect(extractUsesAt(text, cursor)).toBe("./.github/actions/setup");
  });

  it("returns null when cursor is on a non-uses line", () => {
    const text = "      - run: echo hello\n";
    expect(extractUsesAt(text, 5)).toBeNull();
  });

  it("trims trailing comment", () => {
    const text = "      - uses: ./local # local action\n";
    const cursor = text.indexOf("./");
    expect(extractUsesAt(text, cursor)).toBe("./local");
  });

  it("strips surrounding quotes", () => {
    const text = `      - uses: "./local"\n`;
    const cursor = text.indexOf("./");
    expect(extractUsesAt(text, cursor)).toBe("./local");
  });

  it("returns null when uses value is empty", () => {
    const text = "      - uses:\n";
    expect(extractUsesAt(text, 5)).toBeNull();
  });
});
