/**
 * Wire format spoken with VMark's WebSocket bridge.
 *
 * Every frame is a `WsMessage` envelope; correlation is by envelope `id` only —
 * the transport never inspects `payload.type`.
 */

import type WebSocket from 'ws';
import type { BridgeRequest, BridgeResponse } from './types.js';
import type { ClientIdentity, Logger } from './websocketConfig.js';

/**
 * Message format for WebSocket communication.
 */
export interface WsMessage {
  id: string;
  type: 'request' | 'response' | 'status' | 'identify' | 'auth_result';
  payload: BridgeRequest | BridgeResponse;
}

/**
 * Send client identification message.
 *
 * Best-effort: a failed identify must not fail the connection — VMark only
 * uses it to label who is connected.
 */
export function sendIdentify(
  socket: WebSocket | null,
  clientIdentity: ClientIdentity | null,
  logger: Logger
): void {
  if (clientIdentity && socket) {
    const identifyMsg = {
      id: 'identify',
      type: 'identify',
      payload: clientIdentity,
    };
    try {
      socket.send(JSON.stringify(identifyMsg));
    } catch (error) {
      logger.warn('Failed to send identify message:', error);
    }
  }
}
