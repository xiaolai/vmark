/**
 * Correlates native browser navigation events with MCP waiters.
 *
 * Native events are delivered independently of the request that started a
 * navigation. Keeping a small terminal history here makes the race safe in
 * both directions: an event may arrive before the waiter is registered, or a
 * waiter may be registered before the webview finishes loading.
 *
 * The broker does not decode payloads (round 3, #80): it subscribes to
 * `browserNativeEvents`, the one hub that validates every native event and fans
 * the typed result out to it and to the UI handlers alike. Its own copy of the
 * decoding had drifted — a missing `generation` became 0 and a missing `url`
 * became "" here, while the UI side dropped the same payload. What is left
 * here is correlation policy only: a payload without a ticket is correlated
 * under a synthesized `legacy-<tabId>` id.
 *
 * @coordinates-with services/browser/browserNativeEvents — the typed-event source
 * @coordinates-with services/mcpBridge/v2/browserNavigationShared — waits on tickets
 */
import {
  browserNativeEvents,
  type BrowserNativeEvent,
  type BrowserNativeEventSource,
  type BrowserNativeEventSubscription,
} from "./browserNativeEvents";

export type BrowserNavigationEvent =
  | {
      kind: "navigated";
      tabId: string;
      navigationId: string;
      generation: number;
      url: string;
    }
  | {
      kind: "loaded";
      tabId: string;
      navigationId: string;
      generation: number;
      url: string;
      title: string;
    }
  | {
      kind: "failed";
      tabId: string;
      navigationId: string;
      message: string;
    };

export type BrowserWaitResult =
  | Extract<BrowserNavigationEvent, { kind: "loaded" | "failed" }>
  | { kind: "superseded"; tabId: string; navigationId: string }
  | { kind: "timeout"; tabId: string; navigationId: string }
  | { kind: "disabled"; tabId: string; navigationId: string }
  | { kind: "unmounted"; tabId: string; navigationId: string }
  | { kind: "idle"; tabId: string };

type Waiter = {
  resolve: (result: BrowserWaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const legacyNavigationId = (tabId: string): string => `legacy-${tabId}`;

/** A process-local broker. It deliberately contains no React or store state. */
export class BrowserEventBroker {
  private readonly maxTerminalsPerTab: number;
  private readonly latest = new Map<string, string>();
  private readonly terminals = new Map<string, Map<string, BrowserWaitResult>>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly source: BrowserNativeEventSource;
  private subscription: BrowserNativeEventSubscription | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(options: { maxTerminalsPerTab?: number; source?: BrowserNativeEventSource } = {}) {
    this.maxTerminalsPerTab = Math.max(1, options.maxTerminalsPerTab ?? 8);
    this.source = options.source ?? browserNativeEvents;
  }

  publish(event: BrowserNavigationEvent): void {
    const current = this.latest.get(event.tabId);
    if (event.kind === "navigated") {
      this.supersedeOtherWaiters(event.tabId, event.navigationId);
      if (current && current !== event.navigationId) {
        this.resolve(event.tabId, current, {
          kind: "superseded",
          tabId: event.tabId,
          navigationId: current,
        });
      }
      this.latest.set(event.tabId, event.navigationId);
      return;
    }

    this.supersedeOtherWaiters(event.tabId, event.navigationId);
    if (current && current !== event.navigationId) {
      this.resolve(event.tabId, current, {
        kind: "superseded",
        tabId: event.tabId,
        navigationId: current,
      });
    }

    this.latest.set(event.tabId, event.navigationId);
    this.remember(event.tabId, event.navigationId, event);
    this.resolve(event.tabId, event.navigationId, event);
  }

  wait(tabId: string, navigationId?: string, timeoutMs = 12_000): Promise<BrowserWaitResult> {
    const target = navigationId ?? this.latest.get(tabId);
    if (!target) return Promise.resolve({ kind: "idle", tabId });

    const current = this.latest.get(tabId);
    if (current && current !== target) {
      return Promise.resolve({ kind: "superseded", tabId, navigationId: target });
    }

    const terminal = this.terminals.get(tabId)?.get(target);
    if (terminal) return Promise.resolve(terminal);

    return new Promise((resolve) => {
      const key = this.key(tabId, target);
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.removeWaiter(key, waiter);
          resolve({ kind: "timeout", tabId, navigationId: target });
        }, Math.max(0, timeoutMs)),
      };
      const entries = this.waiters.get(key) ?? new Set<Waiter>();
      entries.add(waiter);
      this.waiters.set(key, entries);
    });
  }

  latestNavigationId(tabId: string): string | undefined {
    return this.latest.get(tabId);
  }

  isLoading(tabId: string): boolean | undefined {
    const navigationId = this.latest.get(tabId);
    if (!navigationId) return undefined;
    return !this.terminals.get(tabId)?.has(navigationId);
  }

  /** Subscribe to the native events. Resolves once the hub's listeners are live;
   *  rejects — after undoing the subscription — when one could not be registered,
   *  so an MCP caller fails loudly instead of waiting for an event that cannot
   *  arrive. A later `start()` subscribes again, which re-arms the failed listener. */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const subscription = this.source.subscribe((event) => this.fromNative(event));
    this.subscription = subscription;
    this.startPromise = subscription.ready;
    try {
      await subscription.ready;
    } catch (error) {
      this.startPromise = null;
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.cancelPending();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.startPromise = null;
  }

  /** Resolve in-flight calls before feature teardown removes their listeners. */
  cancelPending(): void {
    for (const key of [...this.waiters.keys()]) {
      const separator = key.indexOf("\u0000");
      const tabId = key.slice(0, separator);
      const navigationId = key.slice(separator + 1);
      this.resolve(tabId, navigationId, { kind: "disabled", tabId, navigationId });
    }
    this.latest.clear();
    this.terminals.clear();
  }

  /**
   * A tab's native surface is active-only. If React unmounts an inactive tab,
   * no later native terminal event can settle its ticket, so clear that tab's
   * broker state and release any waiters with a bounded result.
   */
  cancelTab(tabId: string): void {
    const prefix = `${tabId}\u0000`;
    for (const key of [...this.waiters.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const navigationId = key.slice(prefix.length);
      this.resolve(tabId, navigationId, { kind: "unmounted", tabId, navigationId });
    }
    this.latest.delete(tabId);
    this.terminals.delete(tabId);
  }

  /** The navigation kinds become tickets; crashes, dialogs and popups are the UI's. */
  private fromNative(event: BrowserNativeEvent): void {
    if (event.kind !== "navigated" && event.kind !== "loaded" && event.kind !== "failed") return;
    const { tabId } = event;
    // Older native builds emit no navigationId; correlate under a per-tab stand-in.
    const navigationId = event.navigationId ?? legacyNavigationId(tabId);
    if (event.kind === "navigated") {
      this.publish({ kind: "navigated", tabId, navigationId, generation: event.generation, url: event.url });
    } else if (event.kind === "loaded") {
      const { generation, url, title } = event;
      this.publish({ kind: "loaded", tabId, navigationId, generation, url, title });
    } else {
      this.publish({ kind: "failed", tabId, navigationId, message: event.message });
    }
  }

  private remember(tabId: string, navigationId: string, result: BrowserWaitResult): void {
    const history = this.terminals.get(tabId) ?? new Map<string, BrowserWaitResult>();
    history.delete(navigationId);
    history.set(navigationId, result);
    while (history.size > this.maxTerminalsPerTab) {
      const oldest = history.keys().next().value as string | undefined;
      if (!oldest) break;
      history.delete(oldest);
    }
    this.terminals.set(tabId, history);
  }

  private resolve(tabId: string, navigationId: string, result: BrowserWaitResult): void {
    const key = this.key(tabId, navigationId);
    const entries = this.waiters.get(key);
    if (!entries) return;
    this.waiters.delete(key);
    for (const waiter of entries) {
      clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
  }

  private supersedeOtherWaiters(tabId: string, navigationId: string): void {
    const prefix = `${tabId}\u0000`;
    for (const key of [...this.waiters.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const waitingFor = key.slice(prefix.length);
      if (waitingFor === navigationId) continue;
      this.resolve(tabId, waitingFor, {
        kind: "superseded",
        tabId,
        navigationId: waitingFor,
      });
    }
  }

  private removeWaiter(key: string, waiter: Waiter): void {
    const entries = this.waiters.get(key);
    if (!entries) return;
    entries.delete(waiter);
    if (entries.size === 0) this.waiters.delete(key);
  }

  private key(tabId: string, navigationId: string): string {
    return `${tabId}\u0000${navigationId}`;
  }
}

export const browserEventBroker = new BrowserEventBroker();
