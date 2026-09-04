// @vitest-environment node
// Audit 2026-09-03 S-03 / W11 — the drained recorder buffer is PAGE-CONTROLLED.
// Navigation records come from the native event only (D2v2), so a page-supplied
// `navigate` (and any `url` field) is dropped; a drain is capped at 200 events and
// 256 KiB so a hostile page cannot flood the session.
import { describe, expect, it } from "vitest";
import { MAX_DRAIN_BYTES, MAX_DRAIN_EVENTS, parseDrainedEvents } from "./drainedEvents";

const drain = (events: unknown[]) => JSON.stringify({ events });

describe("parseDrainedEvents", () => {
  it("keeps click / type with their locator fields and the sensitivity hint, and drops a forged extract", () => {
    const r = parseDrainedEvents(
      drain([
        { type: "click", role: "button", name: "Publish" },
        { type: "type", role: "textbox", name: "Password", sensitive: true },
        // The recorder shim never produces `extract`; page-written buffer data
        // that claims one must not become an extraction step.
        { type: "extract", name: "article" },
      ]),
    );
    expect(r.events).toEqual([
      { type: "click", role: "button", name: "Publish" },
      { type: "type", role: "textbox", name: "Password", sensitive: true },
    ]);
    expect(r.truncated).toBe(false);
    expect(r.oversized).toBe(false);
  });

  it("DROPS a page-supplied navigate event — navigation records are host-side only (S-03)", () => {
    const r = parseDrainedEvents(drain([{ type: "navigate", url: "https://evil.example/pwn" }, { type: "click", name: "Go", role: "button" }]));
    expect(r.events).toEqual([{ type: "click", role: "button", name: "Go" }]);
    expect(JSON.stringify(r)).not.toContain("evil.example");
  });

  it("never carries a `url` field from the page, whatever the event type", () => {
    const r = parseDrainedEvents(drain([{ type: "click", role: "link", name: "Home", url: "https://evil.example/x" }]));
    expect(r.events[0]).toEqual({ type: "click", role: "link", name: "Home" });
    expect("url" in r.events[0]).toBe(false);
  });

  it("ignores malformed entries and non-string / non-boolean fields", () => {
    const r = parseDrainedEvents(
      drain([null, 5, "x", { type: "click", role: 7, name: ["a"], sensitive: "yes" }, { type: "explode" }, { role: "button" }]),
    );
    expect(r.events).toEqual([{ type: "click" }]);
  });

  it("returns nothing for unparseable JSON or a payload without an events array", () => {
    expect(parseDrainedEvents("not json").events).toEqual([]);
    expect(parseDrainedEvents(JSON.stringify({ events: "nope" })).events).toEqual([]);
    expect(parseDrainedEvents(JSON.stringify(null)).events).toEqual([]);
    expect(parseDrainedEvents(JSON.stringify([])).events).toEqual([]);
  });

  it(`caps a drain at ${MAX_DRAIN_EVENTS} events and reports the truncation`, () => {
    const flood = Array.from({ length: MAX_DRAIN_EVENTS + 50 }, (_, i) => ({ type: "click", role: "button", name: `b${i}` }));
    const r = parseDrainedEvents(drain(flood));
    expect(r.events).toHaveLength(MAX_DRAIN_EVENTS);
    expect(r.events[0]).toEqual({ type: "click", role: "button", name: "b0" });
    expect(r.truncated).toBe(true);
  });

  it(`refuses a drain over ${MAX_DRAIN_BYTES} bytes outright (nothing is kept from it)`, () => {
    const big = drain([{ type: "click", role: "button", name: "x".repeat(MAX_DRAIN_BYTES) }]);
    const r = parseDrainedEvents(big);
    expect(r.events).toEqual([]);
    expect(r.oversized).toBe(true);
  });

  it("measures the cap in UTF-8 bytes, not UTF-16 code units", () => {
    // 3 bytes per CJK character: 90k characters is 270 KB — over the cap although
    // the string is only ~90k code units long.
    const cjk = drain([{ type: "click", role: "button", name: "汉".repeat(90_000) }]);
    expect(cjk.length).toBeLessThan(MAX_DRAIN_BYTES);
    expect(parseDrainedEvents(cjk).oversized).toBe(true);
  });

  it("passes a forged `sensitive:false` through as a hint only — the redactor decides what it means", () => {
    const r = parseDrainedEvents(drain([{ type: "type", role: "textbox", name: "Password", sensitive: false }]));
    expect(r.events).toEqual([{ type: "type", role: "textbox", name: "Password", sensitive: false }]);
  });
});
