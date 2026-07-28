/**
 * MockBridge — minimal `Bridge` test double.
 *
 * Replaces a 930-line simulator that answered pre-prune request types
 * (`document.getContent`, `format.toggle`, `vmark.insertMathInline`, …) no
 * shipped code can send, and imported twelve types `src/bridge/types.ts` does
 * not export. It compiled nowhere — `tsconfig.json` excluded `__tests__` and
 * lint covered only `src` — so the rot was invisible. Every live test used only
 * the generic `setResponseHandler` path, which is all that survives here.
 *
 * Contract: a request with no configured handler FAILS loudly rather than
 * returning a plausible-looking empty success, so a test that forgets to stub
 * a request type cannot pass by accident.
 */

import type {
  Bridge,
  BridgeRequest,
  BridgeResponse,
} from '../../src/bridge/core-types.js';

/** A request the bridge received, in call order. */
export interface RecordedRequest {
  request: BridgeRequest;
  timestamp: number;
}

/** Canned answer for one request type. */
export type MockResponseHandler = (request: BridgeRequest) => BridgeResponse;

export class MockBridge implements Bridge {
  /** Every request the bridge received, in call order. */
  public readonly requests: RecordedRequest[] = [];

  private connected = true;
  private readonly handlers = new Map<string, MockResponseHandler>();

  /** Register the answer for one `BridgeRequest['type']`. */
  setResponseHandler(type: string, handler: MockResponseHandler): void {
    this.handlers.set(type, handler);
  }

  /** Requests recorded for one request type. */
  getRequestsOfType(type: string): RecordedRequest[] {
    return this.requests.filter((r) => r.request.type === type);
  }

  async send<T = unknown>(request: BridgeRequest): Promise<BridgeResponse<T>> {
    this.requests.push({ request, timestamp: Date.now() });

    if (!this.connected) {
      return { success: false, error: 'MockBridge is disconnected' };
    }

    const handler = this.handlers.get(request.type);
    if (!handler) {
      return {
        success: false,
        error: `MockBridge has no response handler for '${request.type}'`,
      };
    }
    return handler(request) as BridgeResponse<T>;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
