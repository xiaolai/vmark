/**
 * Correlates native browser navigation events with MCP waiters.
 *
 * Native events are delivered independently of the request that started a
 * navigation. Keeping a small terminal history here makes the race safe in
 * both directions: an event may arrive before the waiter is registered, or a
 * waiter may be registered before the webview finishes loading.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

type NativePayload = {
  tabId?: unknown;
  navigationId?: unknown;
  generation?: unknown;
  url?: unknown;
  title?: unknown;
  message?: unknown;
};

const legacyNavigationId = (tabId: string): string => `legacy-${tabId}`;

/** A process-local broker. It deliberately contains no React or store state. */
export class BrowserEventBroker {
  private readonly maxTerminalsPerTab: number;
  private readonly latest = new Map<string, string>();
  private readonly terminals = new Map<string, Map<string, BrowserWaitResult>>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly unlisteners: UnlistenFn[] = [];
  private startPromise: Promise<void> | null = null;

  constructor(options: { maxTerminalsPerTab?: number } = {}) {
    this.maxTerminalsPerTab = Math.max(1, options.maxTerminalsPerTab ?? 8);
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

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = Promise.all([
      this.listen("browser://navigated", (payload) => this.fromNative("navigated", payload)),
      this.listen("browser://loaded", (payload) => this.fromNative("loaded", payload)),
      this.listen("browser://load-failed", (payload) => this.fromNative("failed", payload)),
    ]).then(() => undefined);
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.cancelPending();
    const pending = this.unlisteners.splice(0);
    await Promise.all(pending.map((unlisten) => unlisten()));
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

  private async listen(
    event: string,
    callback: (payload: NativePayload) => void,
  ): Promise<void> {
    const unlisten = await listen<NativePayload>(event, (message) => callback(message.payload));
    this.unlisteners.push(unlisten);
  }

  private fromNative(kind: BrowserNavigationEvent["kind"], payload: NativePayload): void {
    if (typeof payload.tabId !== "string") return;
    const tabId = payload.tabId;
    const navigationId =
      typeof payload.navigationId === "string" ? payload.navigationId : legacyNavigationId(tabId);
    if (kind === "navigated") {
      this.publish({
        kind,
        tabId,
        navigationId,
        generation: typeof payload.generation === "number" ? payload.generation : 0,
        url: typeof payload.url === "string" ? payload.url : "",
      });
    } else if (kind === "loaded") {
      this.publish({
        kind,
        tabId,
        navigationId,
        generation: typeof payload.generation === "number" ? payload.generation : 0,
        url: typeof payload.url === "string" ? payload.url : "",
        title: typeof payload.title === "string" ? payload.title : "",
      });
    } else {
      this.publish({
        kind,
        tabId,
        navigationId,
        message: typeof payload.message === "string" ? payload.message : "navigation failed",
      });
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
