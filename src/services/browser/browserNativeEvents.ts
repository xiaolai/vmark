/**
 * The fan-out hub for the embedded browser's native events (audit round 3, #80).
 *
 * Purpose: hold ONE Tauri subscription per native event, decode each payload once
 * through `browserNativeEventDecoder`, and deliver the typed event to every
 * subscriber. `browserNavEvents` (the window-level UI handlers) and
 * `browserEventBroker` (the MCP navigation waiters) used to each register their own
 * listeners and decode the same payloads separately; they now both subscribe here,
 * so the two can no longer disagree about what an event said.
 *
 * Lifecycle:
 *  - Registration is REF-COUNTED: the first subscriber registers the native
 *    listeners, the last unsubscribe unlistens them. An unsubscribe that lands
 *    before `listen()` resolved undoes the registration when it does.
 *  - Each event's registration is retried with backoff and every failure is logged —
 *    a silent registration failure was a dead tab (#81). The subscription's `ready`
 *    resolves once every event is live and REJECTS once one of them has spent its
 *    budget: the UI consumer ignores it (it warned and carries on with whatever is
 *    live), the broker's `start()` propagates it so an MCP caller fails loudly
 *    instead of waiting 12s for an event that cannot arrive.
 *  - A spent (dead) registration is RE-ARMED when the next subscriber arrives, so a
 *    later `start()` retries what an earlier one gave up on; live registrations are
 *    never duplicated.
 *
 * @coordinates-with services/browser/browserNativeEventDecoder — the validation
 * @coordinates-with services/browser/browserNavEvents — subscriber: UI handlers
 * @coordinates-with services/browser/browserEventBroker — subscriber: navigation waiters
 * @module services/browser/browserNativeEvents
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { browserWarn } from "@/utils/debug";
import {
  BROWSER_NATIVE_EVENTS,
  decodeBrowserNativeEvent,
  type BrowserNativeEvent,
  type BrowserNativeEventName,
} from "./browserNativeEventDecoder";

export type { BrowserNativeEvent } from "./browserNativeEventDecoder";

export interface BrowserNativeEventSubscription {
  /** Resolves when every native listener is registered; rejects when one gave up. */
  ready: Promise<void>;
  /** Stop receiving events. Idempotent. Drops the native listeners with the last subscriber. */
  unsubscribe: () => void;
}

/** What a consumer needs from the hub — injectable so tests can hand a fresh one. */
export interface BrowserNativeEventSource {
  subscribe: (listener: (event: BrowserNativeEvent) => void) => BrowserNativeEventSubscription;
}

/** Listener registration is retried before it is declared dead. */
const REGISTRATION_ATTEMPTS = 3;
const REGISTRATION_BACKOFF_MS = 250;

/** One native event's registration. `dead` means every attempt failed; `cancelled`
 *  means the hub tore it down (no more attempts, and a late `listen()` is undone). */
interface Registration {
  unlisten: UnlistenFn | null;
  settled: Promise<void>;
  dead: boolean;
  cancelled: boolean;
}

export class BrowserNativeEventHub implements BrowserNativeEventSource {
  private readonly listeners = new Set<(event: BrowserNativeEvent) => void>();
  private readonly registrations = new Map<BrowserNativeEventName, Registration>();

  subscribe(listener: (event: BrowserNativeEvent) => void): BrowserNativeEventSubscription {
    this.listeners.add(listener);
    const ready = this.ensureRegistered();
    // Not every subscriber awaits `ready`; a rejection it never looked at must not
    // surface as an unhandled rejection. Awaiting subscribers still see it.
    ready.catch(() => {});
    let active = true;
    return {
      ready,
      unsubscribe: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
        if (this.listeners.size === 0) this.teardown();
      },
    };
  }

  /** Register whatever is not live: everything for the first subscriber, only the
   *  dead events for a later one. Returns the readiness of the whole set. */
  private ensureRegistered(): Promise<void> {
    for (const event of BROWSER_NATIVE_EVENTS) {
      const existing = this.registrations.get(event);
      if (existing && !existing.dead) continue;
      this.registrations.set(event, this.register(event));
    }
    return Promise.all([...this.registrations.values()].map((r) => r.settled)).then(() => undefined);
  }

  private register(event: BrowserNativeEventName): Registration {
    const registration: Registration = {
      unlisten: null,
      dead: false,
      cancelled: false,
      settled: Promise.resolve(),
    };
    registration.settled = new Promise<void>((resolve, reject) => {
      const attempt = (n: number): void => {
        if (registration.cancelled) {
          reject(new Error(`browser: subscription to ${event} cancelled before it registered`));
          return;
        }
        listen<unknown>(event, (message) => this.dispatch(event, message.payload))
          .then((unlisten) => {
            if (registration.cancelled) {
              unlisten(); // torn down before listen() resolved — undo it
              return;
            }
            registration.unlisten = unlisten;
            resolve();
          })
          .catch((error: unknown) => {
            // A dead listener means this part of the chrome silently stops tracking
            // reality — a confirm() parked forever with no dialog, a stale address
            // bar. Say so on EVERY failure, and retry: a registration failure is
            // usually transient (the IPC not ready yet).
            const retrying = !registration.cancelled && n < REGISTRATION_ATTEMPTS;
            browserWarn(
              `browser: failed to subscribe to ${event} (attempt ${n}/${REGISTRATION_ATTEMPTS})` +
                (retrying ? "; retrying" : "; giving up"),
              error,
            );
            if (retrying) {
              setTimeout(() => attempt(n + 1), REGISTRATION_BACKOFF_MS * n);
              return;
            }
            registration.dead = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      };
      attempt(1);
    });
    // Every consumer of `settled` goes through `ensureRegistered`, which hands the
    // aggregate to `subscribe` — and that attaches a handler. This one only keeps a
    // registration nobody is currently waiting on from reporting as unhandled.
    registration.settled.catch(() => {});
    return registration;
  }

  private teardown(): void {
    for (const registration of this.registrations.values()) {
      registration.cancelled = true;
      registration.unlisten?.();
      registration.unlisten = null;
    }
    this.registrations.clear();
  }

  private dispatch(event: BrowserNativeEventName, payload: unknown): void {
    const decoded = decodeBrowserNativeEvent(event, payload);
    if (!decoded) return;
    // Snapshot: a listener may unsubscribe (itself or another) while we iterate.
    for (const listener of [...this.listeners]) listener(decoded);
  }
}

/** The process-local hub every production subscriber shares. */
export const browserNativeEvents = new BrowserNativeEventHub();
