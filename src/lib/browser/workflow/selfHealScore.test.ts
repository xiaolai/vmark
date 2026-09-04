// @vitest-environment node
// WI-4.4 / W-03 — self-heal candidate scoring, extracted from proposeLocatorFix
// (audit r3 #145) so the floor rules and the antonym refusal are pinned on their own.
import { describe, expect, it } from "vitest";
import { MAX_NAME_LEN, NON_PREFIX_FLOOR, candidateFloor, normalizeName, scoreCandidate } from "./selfHealScore";

const READ = { minConfidence: 0.6, write: false };
const WRITE = { minConfidence: 0.6, write: true };
const n = normalizeName;

describe("normalizeName", () => {
  it("NFC-normalizes, strips format characters, collapses whitespace, case-folds and splits into code points", () => {
    expect(n("Cafe\u{0301}")).toEqual(n("Caf\u{00E9}")); // NFD and NFC spellings of the same text
    expect(n("Pub\u{200B}lish")).toEqual(n("publish")); // a zero-width space is not part of the name
    expect(n("  Sign   in\tnow ")).toEqual(Array.from("sign in now"));
    expect(n("Go \u{1F680}")).toEqual(["g", "o", " ", "\u{1F680}"]); // an emoji is one code point, not two units
    expect(n("")).toEqual([]);
  });
});

describe("candidateFloor", () => {
  it("a READ keeps the caller's floor for decoration appended to the same name, 0.85 otherwise", () => {
    expect(candidateFloor(n("Publish now"), n("Publish"), READ)).toBe(0.6);
    expect(candidateFloor(n("Publsh"), n("Publish"), READ)).toBe(NON_PREFIX_FLOOR);
    expect(candidateFloor(n("Unpublish"), n("Publish"), READ)).toBe(NON_PREFIX_FLOOR);
  });

  it("a WRITE holds the strict floor for prefix candidates too — 'Delete all' is not decoration of 'Delete'", () => {
    expect(candidateFloor(n("Delete all"), n("Delete"), WRITE)).toBe(NON_PREFIX_FLOOR);
    expect(candidateFloor(n("Delte"), n("Delete"), WRITE)).toBe(NON_PREFIX_FLOOR);
  });

  it("never lowers a stricter caller floor", () => {
    expect(candidateFloor(n("Publish now"), n("Publish"), { minConfidence: 0.95, write: false })).toBe(0.95);
    expect(candidateFloor(n("Publsh"), n("Publish"), { minConfidence: 0.95, write: false })).toBe(0.95);
    expect(candidateFloor(n("Delete all"), n("Delete"), { minConfidence: 0.95, write: true })).toBe(0.95);
  });
});

describe("scoreCandidate", () => {
  it("scores an identical name 1 and a decorated same name by edit-distance similarity", () => {
    expect(scoreCandidate(n("Save"), n("save"), READ)).toBe(1);
    expect(scoreCandidate(n("Publish"), n("Publish now"), READ)).toBeCloseTo(7 / 11, 10);
  });

  it("the write floor rejects the prefix candidate a read accepts (the round-1 stricter floor, exactly)", () => {
    expect(scoreCandidate(n("Publish"), n("Publish now"), READ)).not.toBeNull();
    expect(scoreCandidate(n("Publish"), n("Publish now"), WRITE)).toBeNull();
    // A decorated name that clears 0.85 heals for a write too — the rule is a floor, not a ban.
    expect(scoreCandidate(n("Publish now"), n("Publish now…"), WRITE)).toBeCloseTo(11 / 12, 10);
  });

  it("refuses a prefixed (antonym) form outright, whatever the policy", () => {
    const anything = { minConfidence: 0, write: false };
    expect(scoreCandidate(n("Publish"), n("Unpublish"), anything)).toBeNull();
    expect(scoreCandidate(n("publish"), n("Cancel publish"), anything)).toBeNull();
    // A format character cannot disguise the prefix as decoration.
    expect(scoreCandidate(n("Publish"), n("Un\u{200B}publish"), anything)).toBeNull();
  });

  it("rejects a candidate below its floor", () => {
    expect(scoreCandidate(n("Loginn"), n("Login"), READ)).toBeNull(); // 0.833 < 0.85
    expect(scoreCandidate(n("Publsh"), n("Publish"), READ)).toBeCloseTo(6 / 7, 10); // 0.857 ≥ 0.85
    expect(scoreCandidate(n("Submit"), n("Xyzabc"), READ)).toBeNull();
  });

  it("treats two empty names as identical and an empty name as unhealable to anything else", () => {
    expect(scoreCandidate([], [], READ)).toBe(1);
    expect(scoreCandidate([], n("Save"), READ)).toBeNull();
    expect(scoreCandidate(n("Save"), [], READ)).toBeNull();
  });

  it("never scores a name longer than the locator cap, on either side (a hostile page cannot burn the CPU)", () => {
    const huge = Array.from("a".repeat(MAX_NAME_LEN + 1));
    const cap = Array.from("a".repeat(MAX_NAME_LEN));
    expect(scoreCandidate(cap, cap, READ)).toBe(1);
    expect(scoreCandidate(huge, huge, READ)).toBeNull();
    expect(scoreCandidate(n("Save"), huge, READ)).toBeNull();
    expect(scoreCandidate(huge, n("Save"), READ)).toBeNull();
  });
});
