// @vitest-environment node
// WI-AL3.2 — the comments panel's focus tests (and the add box's) activate a control only through the focus rig's click (a mouse click as WebKit delivers it: focuses nothing, takes focus to the page) or press (focus, then Enter); a click helper that moves focus otherwise (user-event's click focuses the button, fireEvent's leaves focus where it was) is refused, since under it a test passes that WebKit fails; the WebKit tier's own files click in the real engine and are not held to it
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
// A WebKit-tier file clicks in the real engine, so its clicks move focus as the app's do.
const FOCUS_TESTS = readdirSync(HERE).filter((f) => (/^comment.*Focus.*\.test\.tsx$/.test(f) && !f.includes(".webkit.")) || f === "addComment.test.tsx");
const FOCUSING_CLICK = /\b(?:user|userEvent|userEvent\.setup\(\)|fireEvent)\.click\(/g;

describe("focus test discipline", () => {
  it("finds the focus tests it guards", () => {
    expect(FOCUS_TESTS.length).toBeGreaterThan(1);
    expect(FOCUS_TESTS).toContain("addComment.test.tsx");
  });

  it.each(FOCUS_TESTS)("%s activates controls only through the rig's click and press", (file) => {
    const lines = readFileSync(join(HERE, file), "utf8").split("\n");
    const offenders = lines.flatMap((line, i) => (line.match(FOCUSING_CLICK) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
    expect(offenders).toEqual([]);
  });
});
