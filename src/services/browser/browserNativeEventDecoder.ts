/**
 * The ONE decoder for the embedded browser's native events (audit round 3, #80).
 *
 * Purpose: `browser/nav_delegate_macos.rs` emits six events — `browser://navigated`
 * (committed), `browser://loaded` (finished, with title), `browser://load-failed`,
 * `browser://crashed`, `browser://dialog` and `browser://popup`. Two consumers read
 * them: the UI handlers behind `browserNavEvents` and the MCP navigation waiters in
 * `browserEventBroker`. Each used to decode the raw payload on its own, and the two
 * had drifted — the broker defaulted a missing `generation` to 0 and a missing `url`
 * to "", the very values the round-2 validation (#81) refuses because they bypass
 * every stale-generation check downstream. This module is the single place a raw
 * payload becomes a typed `BrowserNativeEvent`; `browserNativeEvents` fans the result
 * out to every subscriber, so no consumer can decode differently again.
 *
 * Validation, per kind:
 *  - every payload: `tabId` must be a string — the event is otherwise unattributable.
 *  - navigated / loaded: `url` must parse and `generation` must be a non-negative
 *    integer (#81); a `title` that is not a string is "", the redirect and
 *    back/forward flags coerce to `false`, and `navigationId` is carried only when
 *    it is a string. Dropped with a warning otherwise.
 *  - failed: `message` must be a string. A message is never invented here — a
 *    user-facing string would have to be translated, and the emitter always sends one.
 *  - crashed: an unrecognized action fails CLOSED to `manual` — we do not know a
 *    reload is coming, so ask the user rather than show a "reloading…" that never ends.
 *  - dialog: never dropped. A `confirm()` parks the page's JS until someone answers,
 *    so a malformed dialog still reaches the user — a confirm without a numeric
 *    completion-handler `id` degrades to an alert (its answer would reach nobody),
 *    and a non-string message becomes "".
 *  - popup: `url` must be a string.
 *
 * @coordinates-with src-tauri browser/nav_payloads_macos.rs — the wire contract
 * @coordinates-with services/browser/browserNativeEvents — the subscription hub that calls this
 * @coordinates-with services/browser/browserNavEvents — UI-handler consumer of the typed events
 * @coordinates-with services/browser/browserEventBroker — MCP-waiter consumer of the typed events
 * @module services/browser/browserNativeEventDecoder
 */
import { browserWarn } from "@/utils/debug";
import type { BrowserDialog, CrashAction } from "@/stores/browserUiStore";

/** Every native event the emitter produces; the hub registers exactly these. */
export const BROWSER_NATIVE_EVENTS = [
  "browser://navigated",
  "browser://loaded",
  "browser://load-failed",
  "browser://crashed",
  "browser://dialog",
  "browser://popup",
] as const;

export type BrowserNativeEventName = (typeof BROWSER_NATIVE_EVENTS)[number];

/** Back/forward-list state, carried by every event that can change it (WI-S1.6). */
interface HistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
}

/** A native event after validation. `navigationId` is present only when the payload
 *  carried one (an older driver omits it); consumers decide how to correlate. */
export type BrowserNativeEvent =
  | ({
      kind: "navigated";
      tabId: string;
      url: string;
      generation: number;
      /** This navigation followed a server redirect (WI-S2.2). */
      redirected: boolean;
      navigationId?: string;
    } & HistoryState)
  | ({
      kind: "loaded";
      tabId: string;
      url: string;
      title: string;
      /** Committed generation of the page that finished — lets a store drop a stale
       *  (out-of-order) loaded event, the same way `navigated` does. */
      generation: number;
      navigationId?: string;
    } & HistoryState)
  | { kind: "failed"; tabId: string; message: string; navigationId?: string }
  | { kind: "crashed"; tabId: string; action: CrashAction }
  | { kind: "dialog"; tabId: string; dialog: BrowserDialog }
  | { kind: "popup"; tabId: string; url: string };

type Raw = Record<string, unknown>;

function drop(event: BrowserNativeEventName, payload: unknown): null {
  browserWarn(`browser: dropped malformed ${event} payload`, payload);
  return null;
}

/** The fields every navigation consumer relies on (#81). A malformed one is
 *  refused rather than handed downstream as an `undefined` generation and URL,
 *  which would bypass the stores' stale-generation rejection. */
function navigationFields(p: Raw): { url: string; generation: number } | null {
  const { url, generation } = p;
  if (typeof url !== "string" || !URL.canParse(url)) return null;
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  return { url, generation };
}

/** Coerce the history flags: an older/partial payload must disable the controls,
 *  never hand `undefined` to the store as if it were a known state. */
function historyState(p: Raw): HistoryState {
  return { canGoBack: !!p.canGoBack, canGoForward: !!p.canGoForward };
}

/** Present only when it is a string — `exactOptionalPropertyTypes` forbids an
 *  explicit `undefined`, and a consumer distinguishes "absent" from a value. */
function navigationId(p: Raw): { navigationId: string } | Record<string, never> {
  return typeof p.navigationId === "string" ? { navigationId: p.navigationId } : {};
}

function toCrashAction(action: unknown): CrashAction {
  return action === "auto-reload" ? "auto-reload" : "manual";
}

function toDialog(p: Raw): BrowserDialog {
  const message = typeof p.message === "string" ? p.message : "";
  return p.kind === "confirm" && typeof p.id === "number"
    ? { kind: "confirm", message, id: p.id }
    : { kind: "alert", message };
}

/**
 * Decode one raw native payload into a typed event, or `null` (with a warning)
 * when it is malformed. Pure: no store, no Tauri.
 */
export function decodeBrowserNativeEvent(event: BrowserNativeEventName, payload: unknown): BrowserNativeEvent | null {
  if (typeof payload !== "object" || payload === null) return drop(event, payload);
  const p = payload as Raw;
  if (typeof p.tabId !== "string") return drop(event, payload);
  const tabId = p.tabId;

  switch (event) {
    case "browser://navigated": {
      const nav = navigationFields(p);
      if (!nav) return drop(event, payload);
      return { kind: "navigated", tabId, ...nav, redirected: !!p.redirected, ...navigationId(p), ...historyState(p) };
    }
    case "browser://loaded": {
      const nav = navigationFields(p);
      if (!nav) return drop(event, payload);
      const title = typeof p.title === "string" ? p.title : "";
      return { kind: "loaded", tabId, ...nav, title, ...navigationId(p), ...historyState(p) };
    }
    case "browser://load-failed":
      if (typeof p.message !== "string") return drop(event, payload);
      return { kind: "failed", tabId, message: p.message, ...navigationId(p) };
    case "browser://crashed":
      return { kind: "crashed", tabId, action: toCrashAction(p.action) };
    case "browser://dialog":
      return { kind: "dialog", tabId, dialog: toDialog(p) };
    case "browser://popup":
      if (typeof p.url !== "string") return drop(event, payload);
      return { kind: "popup", tabId, url: p.url };
  }
}
