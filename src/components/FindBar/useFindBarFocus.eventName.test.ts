// @vitest-environment node
//
// Audit 20260907 round 3 (#600). `use-selection-for-find` is a window event
// whose PRODUCER is `hooks/useSearchCommands.ts` and whose CONSUMER is
// `useFindBarFocus.ts`. Nothing joins the two spellings — no import, no type —
// so a typo on either side is a menu item that silently does nothing. That is
// not hypothetical: WI-FL3.4 exists because the menu binding was relayed to an
// event with no listener at all.
//
// The producer is read from SOURCE rather than executed: running it means the
// Tauri window API, an async listener registration and a menu payload, none of
// which say anything about the string.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { USE_SELECTION_FOR_FIND_EVENT } from "./useFindBarFocus";

const producer = fileURLToPath(new URL("../../hooks/useSearchCommands.ts", import.meta.url));

describe("the use-selection-for-find contract", () => {
  it("is dispatched by useSearchCommands under exactly the name this hook listens for", () => {
    const source = readFileSync(producer, "utf8");
    const dispatched = [...source.matchAll(/new CustomEvent\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(dispatched).toContain(USE_SELECTION_FOR_FIND_EVENT);
  });

  it("has exactly one producer, so there is one name to keep in step", () => {
    const source = readFileSync(producer, "utf8");
    expect([...source.matchAll(/new CustomEvent\(/g)]).toHaveLength(1);
  });
});
