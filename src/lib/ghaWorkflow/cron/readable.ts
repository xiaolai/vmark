/**
 * Purpose: Render a GitHub Actions schedule.cron expression as a
 *   human-readable English summary, plus flag schedules that GHA
 *   throttles silently (under-5-minute interval) per actionlint
 *   policy.
 *
 *   GHA cron syntax is the standard POSIX 5-field form:
 *     minute (0-59) | hour (0-23) | day-of-month (1-31) |
 *     month (1-12 / JAN-DEC) | day-of-week (0-7 / SUN-SAT, where
 *                             both 0 and 7 are Sunday)
 *
 *   Each field accepts: `*`, `N`, `N-M`, `N,M`, `* /N`, `N-M/K`.
 *
 *   Why a custom parser instead of cronstrue: cronstrue is ~12 KB
 *   gzipped (lazy) and adds a dep; the syntax surface above is
 *   small enough to cover exhaustively in ~80 LOC with stronger
 *   tests for the GHA-specific edge cases (throttle threshold,
 *   day-of-week range rendering).
 *
 * @module lib/ghaWorkflow/cron/readable
 */

const DOW_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface FieldSpec {
  name: "minute" | "hour" | "dom" | "month" | "dow";
  min: number;
  max: number;
  aliases?: Record<string, number>;
}

const FIELDS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  {
    name: "month",
    min: 1,
    max: 12,
    aliases: Object.fromEntries(
      MONTH_NAMES.map((m, i) => [m.toUpperCase(), i + 1]),
    ),
  },
  {
    name: "dow",
    min: 0,
    max: 7,
    aliases: Object.fromEntries(
      DOW_NAMES.map((d, i) => [d.toUpperCase(), i]),
    ),
  },
];

export interface ParsedCron {
  raw: string;
  /** Each field as the explicit list of allowed values. `null` = wildcard. */
  fields: (number[] | null)[];
  /** Smallest interval in minutes between fires. */
  intervalMinutes: number;
}

/**
 * Discriminated union for the time portion of a cron expression.
 * Callers translate each kind via i18n keys
 * `form.trigger.cron.<kind>` (Codex audit MED-5 fix — readable.ts
 * was previously English-only with no path to localized output).
 */
export type CronTimePart =
  | { kind: "every-minute" }
  | { kind: "every-n-minutes"; n: number }
  | { kind: "at-time"; time: string }
  | { kind: "at-times"; times: string[] }
  | { kind: "at-times-many"; visible: string[]; rest: number }
  | { kind: "every-minute-of-hour"; hours: string }
  | { kind: "every-hour-on-the-hour" }
  | { kind: "at-minute-of-every-hour"; minutes: string };

/**
 * Modifiers attached to the time clause:
 *   - dom: day-of-month list (e.g., "1, 15")
 *   - month: month abbreviations (e.g., "Jan, Feb")
 *   - dowList: day-of-week as comma list (e.g., "Mon, Wed")
 *   - dowRange: contiguous range (e.g., { from: "Mon", to: "Fri" })
 */
export interface CronModifiers {
  dom?: string;
  month?: string;
  dowList?: string;
  dowRange?: { from: string; to: string };
}

export interface CronReadable {
  /** English fallback rendering (for callers that don't translate). */
  text: string;
  /** Structured time clause for translation. */
  time: CronTimePart;
  /** Structured modifiers for translation. */
  modifiers: CronModifiers;
  /** True when the smallest fire interval is below 5 minutes. */
  throttled: boolean;
}

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

function parseValue(token: string, field: FieldSpec): number {
  const upper = token.toUpperCase();
  if (field.aliases && upper in field.aliases) return field.aliases[upper];
  const n = Number(token);
  if (!Number.isInteger(n) || n < field.min || n > field.max) {
    throw new CronParseError(
      `Value '${token}' out of range for ${field.name} (${field.min}-${field.max})`,
    );
  }
  return n;
}

function expandRange(spec: string, field: FieldSpec): number[] | null {
  if (spec === "*") return null;

  const stepMatch = spec.match(
    /^(\*|\d+(?:-\d+)?|[A-Z]+(?:-[A-Z]+)?)\/(\d+)$/,
  );
  if (stepMatch) {
    const [, basePart, stepStr] = stepMatch;
    const step = Number(stepStr);
    if (step <= 0) {
      throw new CronParseError(
        `Invalid step '${step}' in ${field.name} field`,
      );
    }
    let start = field.min;
    let end = field.max;
    if (basePart !== "*") {
      const range = expandRange(basePart, field);
      if (range !== null && range.length > 0) {
        start = range[0];
        end = range[range.length - 1];
      }
    }
    const out: number[] = [];
    for (let v = start; v <= end; v += step) out.push(v);
    return out;
  }

  const rangeMatch = spec.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (rangeMatch) {
    const a = parseValue(rangeMatch[1], field);
    const b = parseValue(rangeMatch[2], field);
    if (a > b) {
      throw new CronParseError(
        `Reversed range '${spec}' in ${field.name} field`,
      );
    }
    const out: number[] = [];
    for (let v = a; v <= b; v++) out.push(v);
    return out;
  }

  return [parseValue(spec, field)];
}

export function parseCron(input: string): ParsedCron {
  const trimmed = input.trim();
  if (!trimmed) throw new CronParseError("Empty cron expression");
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      `Expected 5 fields, got ${parts.length}: '${trimmed}'`,
    );
  }
  const fields: (number[] | null)[] = parts.map((part, i) => {
    const field = FIELDS[i];
    const segments = part.split(",");
    const collected = new Set<number>();
    let anyWildcard = false;
    for (const seg of segments) {
      const expanded = expandRange(seg, field);
      if (expanded === null) {
        anyWildcard = true;
      } else {
        for (const v of expanded) collected.add(v);
      }
    }
    if (anyWildcard) return null;
    if (field.name === "dow" && collected.has(7)) {
      collected.delete(7);
      collected.add(0);
    }
    return [...collected].sort((a, b) => a - b);
  });

  const minutes = fields[0];
  const hours = fields[1];
  let intervalMinutes: number;
  if (minutes === null) {
    intervalMinutes = 1;
  } else if (minutes.length > 1) {
    let smallest = Infinity;
    for (let i = 1; i < minutes.length; i++) {
      smallest = Math.min(smallest, minutes[i] - minutes[i - 1]);
    }
    smallest = Math.min(
      smallest,
      60 - minutes[minutes.length - 1] + minutes[0],
    );
    intervalMinutes = smallest;
  } else if (hours === null) {
    intervalMinutes = 60;
  } else if (hours.length > 1) {
    let smallest = Infinity;
    for (let i = 1; i < hours.length; i++) {
      smallest = Math.min(smallest, (hours[i] - hours[i - 1]) * 60);
    }
    intervalMinutes = smallest;
  } else {
    intervalMinutes = 1440;
  }

  return { raw: trimmed, fields, intervalMinutes };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildTimePart(
  minutes: number[] | null,
  hours: number[] | null,
): CronTimePart {
  if (minutes === null && hours === null) {
    return { kind: "every-minute" };
  }
  if (minutes === null) {
    return { kind: "every-minute-of-hour", hours: hours!.join(", ") };
  }
  if (hours === null) {
    if (minutes.length === 1 && minutes[0] === 0) {
      return { kind: "every-hour-on-the-hour" };
    }
    return {
      kind: "at-minute-of-every-hour",
      minutes: minutes.join(", "),
    };
  }
  const times: string[] = [];
  for (const h of hours) {
    for (const m of minutes) {
      times.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  if (times.length === 1) return { kind: "at-time", time: times[0] };
  if (times.length <= 4) return { kind: "at-times", times };
  return {
    kind: "at-times-many",
    visible: times.slice(0, 3),
    rest: times.length - 3,
  };
}

function buildModifiers(
  dom: number[] | null,
  month: number[] | null,
  dow: number[] | null,
): CronModifiers {
  const out: CronModifiers = {};
  if (dom !== null) out.dom = dom.join(", ");
  if (month !== null) {
    out.month = month.map((m) => MONTH_NAMES[m - 1]).join(", ");
  }
  if (dow !== null) {
    if (dow.length >= 3) {
      const sorted = [...dow].sort((a, b) => a - b);
      let isRange = true;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
          isRange = false;
          break;
        }
      }
      if (isRange) {
        out.dowRange = {
          from: DOW_NAMES[sorted[0]],
          to: DOW_NAMES[sorted[sorted.length - 1]],
        };
      } else {
        out.dowList = dow.map((d) => DOW_NAMES[d]).join(", ");
      }
    } else {
      out.dowList = dow.map((d) => DOW_NAMES[d]).join(", ");
    }
  }
  return out;
}

/** English-only fallback renderer for callers that don't translate. */
function renderTimePartEnglish(part: CronTimePart): string {
  switch (part.kind) {
    case "every-minute":
      return "every minute";
    case "every-n-minutes":
      return `every ${part.n} minutes`;
    case "at-time":
      return `at ${part.time}`;
    case "at-times":
      return `at ${part.times.join(", ")}`;
    case "at-times-many":
      return `at ${part.visible.join(", ")} (+${part.rest} more)`;
    case "every-minute-of-hour":
      return `every minute of hour ${part.hours}`;
    case "every-hour-on-the-hour":
      return "every hour on the hour";
    case "at-minute-of-every-hour":
      return `at minute ${part.minutes} of every hour`;
  }
}

function renderModifiersEnglish(mod: CronModifiers): string {
  let out = "";
  if (mod.dom) out += ` on day-of-month ${mod.dom}`;
  if (mod.month) out += ` in ${mod.month}`;
  if (mod.dowRange) out += ` on ${mod.dowRange.from}-${mod.dowRange.to}`;
  else if (mod.dowList) out += ` on ${mod.dowList}`;
  return out;
}

export function cronToReadable(input: string): CronReadable {
  const parsed = parseCron(input);
  const [minute, hour, dom, month, dow] = parsed.fields;

  let time: CronTimePart;
  if (
    minute !== null &&
    minute.length > 1 &&
    hour === null &&
    dom === null &&
    month === null &&
    dow === null
  ) {
    const interval = parsed.intervalMinutes;
    const allDivisible = minute.every((m) => m % interval === 0);
    if (allDivisible && minute[0] === 0) {
      time = { kind: "every-n-minutes", n: interval };
    } else {
      time = buildTimePart(minute, hour);
    }
  } else {
    time = buildTimePart(minute, hour);
  }

  const modifiers = buildModifiers(dom, month, dow);
  const text = renderTimePartEnglish(time) + renderModifiersEnglish(modifiers);

  return {
    text,
    time,
    modifiers,
    throttled: parsed.intervalMinutes < 5,
  };
}
