/**
 * Drained recorder buffer → typed events (audit 2026-09-03 S-03 / W11).
 *
 * The recorder shim's ring buffer is a PAGE-WRITABLE DOM element, so everything
 * drained from it is untrusted page data. This parser is the trust boundary:
 *
 *   - A `navigate` event is DROPPED. Navigation records come host-side from the
 *     native `browser://navigated` event (D2v2 — `recorderSession.recordNavigation`),
 *     never from the page; a page that could inject one could steer a replay to
 *     `navigate to <attacker-url>`.
 *   - No `url` field is ever read, whatever the event type.
 *   - One drain is capped at `MAX_DRAIN_EVENTS` entries and `MAX_DRAIN_BYTES` of
 *     raw JSON (UTF-8). An oversized payload is refused whole — a page that
 *     produces 256 KiB between two 500 ms drains is not recording a user.
 *   - Typed VALUES never appear here (the shim never records one); only locators
 *     and the `sensitive` hint, which chooses between two value-free forms in the
 *     redactor and can never turn a value into a literal.
 *
 * Leaf-pure: JSON string in, events out.
 *
 * @coordinates-with lib/browser/agent/recorderShim.ts — the drain script producing the JSON
 * @coordinates-with lib/browser/workflow/recorder.ts — consumes the events (P-2 redaction)
 * @coordinates-with services/mcpBridge/v2/browserRecord.ts — the host drain that calls this
 * @module lib/browser/workflow/drainedEvents
 */
import type { RecordedEvent } from "./recorder";

/** Per-drain event cap (D2v2: 200 events per document). */
export const MAX_DRAIN_EVENTS = 200;
/** Per-drain raw payload cap, in UTF-8 bytes. */
export const MAX_DRAIN_BYTES = 256 * 1024;

// Only what the recorder shim PRODUCES. `extract` was listed too, so page-written
// buffer data could forge an extraction step no trusted producer ever emits.
const PAGE_EVENT_TYPES: ReadonlySet<string> = new Set(["click", "type"]);

export interface DrainedEvents {
  events: RecordedEvent[];
  /** More than `MAX_DRAIN_EVENTS` entries were present; the excess was dropped. */
  truncated: boolean;
  /** The raw payload exceeded `MAX_DRAIN_BYTES`; nothing was kept. */
  oversized: boolean;
}

/** Parse the (page-controlled, untrusted) drained buffer into typed events. */
export function parseDrainedEvents(raw: string): DrainedEvents {
  if (new TextEncoder().encode(raw).length > MAX_DRAIN_BYTES) {
    return { events: [], truncated: false, oversized: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { events: [], truncated: false, oversized: false };
  }
  if (typeof parsed === "object" && parsed !== null && (parsed as { oversized?: unknown }).oversized === true) {
    // The drain script refused to parse an over-long buffer in the page (shimDrain.ts).
    return { events: [], truncated: false, oversized: true };
  }
  const arr = typeof parsed === "object" && parsed !== null ? (parsed as { events?: unknown }).events : undefined;
  if (!Array.isArray(arr)) return { events: [], truncated: false, oversized: false };

  const events: RecordedEvent[] = [];
  // Inspect at most MAX_DRAIN_EVENTS ENTRIES — not "accept at most that many": the
  // documented cap is on what is consumed, and counting accepted events let a
  // hostile page push validation past it with junk entries.
  for (const entry of arr.slice(0, MAX_DRAIN_EVENTS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const type = e.type;
    if (typeof type !== "string" || !PAGE_EVENT_TYPES.has(type)) continue; // `navigate` lands here
    const ev: RecordedEvent = { type: type as RecordedEvent["type"] };
    if (typeof e.role === "string") ev.role = e.role;
    if (typeof e.name === "string") ev.name = e.name;
    if (typeof e.sensitive === "boolean") ev.sensitive = e.sensitive;
    events.push(ev);
  }
  return { events, truncated: arr.length > MAX_DRAIN_EVENTS, oversized: false };
}
