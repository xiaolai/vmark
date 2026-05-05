// WI-A.3 — cron-readable parser tests. TDD-first per .claude/rules/10-tdd.md.

import { describe, it, expect } from "vitest";
import { parseCron, cronToReadable, CronParseError } from "./readable";

describe("parseCron — structure", () => {
  it("parses 5 fields", () => {
    const r = parseCron("0 2 * * 1-5");
    expect(r.fields).toHaveLength(5);
  });

  it("rejects empty input", () => {
    expect(() => parseCron("")).toThrow(CronParseError);
    expect(() => parseCron("   ")).toThrow(CronParseError);
  });

  it("rejects wrong field count", () => {
    expect(() => parseCron("0 2 * *")).toThrow(/5 fields, got 4/);
    expect(() => parseCron("0 2 * * 1-5 *")).toThrow(/5 fields, got 6/);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseCron("60 * * * *")).toThrow(/minute/);
    expect(() => parseCron("0 24 * * *")).toThrow(/hour/);
    expect(() => parseCron("0 0 32 * *")).toThrow(/dom/);
    expect(() => parseCron("0 0 1 13 *")).toThrow(/month/);
    expect(() => parseCron("0 0 1 1 7")).not.toThrow(); // 7=Sunday accepted
    expect(() => parseCron("0 0 1 1 8")).toThrow(/dow/); // 8 out of range
  });

  it("rejects reversed ranges", () => {
    expect(() => parseCron("0 0 * * 5-1")).toThrow(/Reversed range/);
  });

  it("rejects invalid step", () => {
    expect(() => parseCron("*/0 * * * *")).toThrow(/Invalid step/);
  });
});

describe("parseCron — field expansion", () => {
  it("wildcards stay as null", () => {
    const r = parseCron("* * * * *");
    expect(r.fields).toEqual([null, null, null, null, null]);
  });

  it("expands ranges", () => {
    const r = parseCron("0 0 * * 1-5");
    expect(r.fields[4]).toEqual([1, 2, 3, 4, 5]);
  });

  it("expands lists", () => {
    const r = parseCron("0 0 * * 1,3,5");
    expect(r.fields[4]).toEqual([1, 3, 5]);
  });

  it("expands steps", () => {
    const r = parseCron("*/15 * * * *");
    expect(r.fields[0]).toEqual([0, 15, 30, 45]);
  });

  it("expands range/step combo", () => {
    const r = parseCron("0 0-22/2 * * *");
    expect(r.fields[1]).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  it("normalizes dow 7 to 0 (both Sunday)", () => {
    const r = parseCron("0 0 * * 7");
    expect(r.fields[4]).toEqual([0]);
  });

  it("accepts named day-of-week aliases", () => {
    const r = parseCron("0 0 * * MON-FRI");
    expect(r.fields[4]).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts named month aliases", () => {
    const r = parseCron("0 0 * JAN-MAR *");
    expect(r.fields[3]).toEqual([1, 2, 3]);
  });
});

describe("parseCron — interval calculation (for throttle warning)", () => {
  it("every minute (*) is 1", () => {
    expect(parseCron("* * * * *").intervalMinutes).toBe(1);
  });

  it("*/5 minutes is 5", () => {
    expect(parseCron("*/5 * * * *").intervalMinutes).toBe(5);
  });

  it("*/4 minutes is 4 (will throttle)", () => {
    expect(parseCron("*/4 * * * *").intervalMinutes).toBe(4);
  });

  it("0,30 is 30", () => {
    expect(parseCron("0,30 * * * *").intervalMinutes).toBe(30);
  });

  it("hourly is 60", () => {
    expect(parseCron("0 * * * *").intervalMinutes).toBe(60);
  });

  it("daily is 1440", () => {
    expect(parseCron("0 2 * * *").intervalMinutes).toBe(1440);
  });
});

describe("cronToReadable", () => {
  it("renders 'every N minutes' for */N pattern", () => {
    expect(cronToReadable("*/5 * * * *").text).toBe("every 5 minutes");
    expect(cronToReadable("*/15 * * * *").text).toBe("every 15 minutes");
    expect(cronToReadable("*/30 * * * *").text).toBe("every 30 minutes");
  });

  it("renders 'every minute' for full wildcard", () => {
    expect(cronToReadable("* * * * *").text).toBe("every minute");
  });

  it("renders 'at HH:MM' for specific time", () => {
    expect(cronToReadable("0 2 * * *").text).toBe("at 02:00");
    expect(cronToReadable("30 14 * * *").text).toBe("at 14:30");
  });

  it("renders weekday range as 'Mon-Fri'", () => {
    const r = cronToReadable("0 2 * * 1-5");
    expect(r.text).toBe("at 02:00 on Mon-Fri");
  });

  it("renders day-of-month and month", () => {
    const r = cronToReadable("0 0 1 1 *");
    expect(r.text).toBe("at 00:00 on day-of-month 1 in Jan");
  });

  it("renders comma-separated dow as named list", () => {
    expect(cronToReadable("0 12 * * 1,3,5").text).toContain("Mon, Wed, Fri");
  });

  it("flags throttled intervals", () => {
    expect(cronToReadable("*/4 * * * *").throttled).toBe(true);
    expect(cronToReadable("* * * * *").throttled).toBe(true);
    expect(cronToReadable("*/3 * * * *").throttled).toBe(true);
  });

  it("does NOT flag intervals at the 5-minute boundary", () => {
    expect(cronToReadable("*/5 * * * *").throttled).toBe(false);
    expect(cronToReadable("*/15 * * * *").throttled).toBe(false);
    expect(cronToReadable("0 2 * * *").throttled).toBe(false);
  });

  it("compresses many time combinations to '+N more'", () => {
    const r = cronToReadable("0,15,30,45 0,6,12,18 * * *");
    expect(r.text).toMatch(/\+\d+ more/);
  });

  it("renders multiple full-day schedules cleanly", () => {
    expect(cronToReadable("0 0,12 * * *").text).toBe("at 00:00, 12:00");
  });

  it("handles 'every minute of hour H'", () => {
    expect(cronToReadable("* 14 * * *").text).toBe(
      "every minute of hour 14",
    );
  });
});
