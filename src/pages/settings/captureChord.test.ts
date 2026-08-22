// @vitest-environment node
// WI-TNAV2.3 — the chord-capture round trip the test matrix required.
//
// It was not written the first time, and had it been, it would have FAILED:
// KeyCapture collapsed both Cmd and physical Ctrl into `Mod`, so on macOS a
// literal Ctrl chord could never be captured and every shipped `Ctrl-…` default
// was impossible to re-enter after being changed.
import { describe, expect, it } from "vitest";
import { captureChord } from "./captureChord";
import { canonicalizeChordString } from "@/utils/keybinding/canonicalChord";

const ev = (o: Partial<Parameters<typeof captureChord>[0]> & { key: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

describe("captureChord", () => {
  it("captures physical Ctrl as Ctrl on macOS, never as Mod", () => {
    const got = captureChord(ev({ key: "Tab", ctrlKey: true }), true);
    expect(got).toBe("Ctrl-Tab");
    // Decisive: `Mod-Tab` is Cmd+Tab on macOS — a different chord, owned by the OS.
    expect(got).not.toBe("Mod-Tab");
  });

  it("captures Cmd as Mod on macOS", () => {
    expect(captureChord(ev({ key: "Tab", metaKey: true }), true)).toBe("Mod-Tab");
  });

  it("distinguishes Cmd+Ctrl from either alone on macOS", () => {
    expect(captureChord(ev({ key: "k", metaKey: true, ctrlKey: true }), true)).toBe("Mod-Ctrl-k");
  });

  it("collapses Ctrl to Mod off macOS, where Mod IS Ctrl", () => {
    expect(captureChord(ev({ key: "Tab", ctrlKey: true }), false)).toBe("Mod-Tab");
  });

  it("round-trips through the canonicalizer to the shipped default", () => {
    const captured = captureChord(ev({ key: "Tab", ctrlKey: true }), true)!;
    expect(canonicalizeChordString(captured, "mac")).toBe(
      canonicalizeChordString("Ctrl-Tab", "mac"),
    );
  });

  it.each(["Control", "Alt", "Shift", "Meta"])("returns null for the lone modifier %s", (key) => {
    expect(captureChord(ev({ key }), true)).toBeNull();
  });

  it.each([
    [" ", "Space"],
    ["ArrowLeft", "Left"],
    ["ArrowDown", "Down"],
  ])("maps the special key %s to %s", (key, expected) => {
    expect(captureChord(ev({ key }), true)).toBe(expected);
  });

  it("lowercases single characters so chords are case-stable", () => {
    expect(captureChord(ev({ key: "K", metaKey: true, shiftKey: true }), true)).toBe("Mod-Shift-k");
  });
});
