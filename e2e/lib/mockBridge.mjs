/**
 * A minimal, dependency-free stand-in for the Tauri automation bridge.
 *
 * `wait-ready.mjs` is the first thing every Tier-0 CI run executes, and until
 * now nothing tested the part that matters: the connect → list_windows →
 * execute_js sequence, the retry loop, the deadline, and the exit codes. Only
 * argument parsing was covered, because only argument parsing could be reached
 * without a running app.
 *
 * A real app is not the only way to have a bridge. This speaks enough of
 * RFC 6455 to serve that one request/response protocol, so the orchestration
 * can be driven through every branch — including the ones that are hard to
 * produce on purpose against a real app: a window that appears late, a
 * handshake that completes on the third poll, a bridge that answers
 * `success: false`.
 *
 * Deliberately hand-rolled rather than pulling in `ws`: the payloads are small
 * text frames on loopback, so the subset needed is the handshake, one masked
 * client frame and one unmasked server frame. A dependency added for one test
 * is a dependency the app then carries.
 *
 * @module e2e/lib/mockBridge
 */
import { createServer } from "node:net";
import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** Encode one unmasked text frame (server → client). */
function encodeText(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
    return Buffer.concat([head, payload]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x81;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([head, payload]);
}

/**
 * Pull complete frames out of an accumulating buffer.
 * Returns `{ frames, rest }`; an incomplete trailing frame stays in `rest`.
 */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    let mask = null;
    if (masked) {
      if (buffer.length - cursor < 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buffer.length - cursor < length) break;

    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Start a mock bridge on an OS-assigned port.
 *
 * @param {(request: {id: string, command: string, args: object}) => object|null} handle
 *   Returns the reply object (without `id`), or null to send nothing at all —
 *   which is how a hung bridge is simulated.
 * @returns {Promise<{port: number, requests: object[], close: () => Promise<void>}>}
 */
export function startMockBridge(handle) {
  const requests = [];
  const sockets = new Set();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));

    let buffer = Buffer.alloc(0);
    let upgraded = false;

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const key = /sec-websocket-key:\s*(.+)/i.exec(header)?.[1]?.trim();
        buffer = buffer.subarray(headerEnd + 4);
        upgraded = true;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${acceptKey(key ?? "")}\r\n\r\n`,
        );
      }

      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 0x1) continue;
        let request;
        try {
          request = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          continue;
        }
        requests.push(request);
        const reply = handle(request);
        if (reply === null) continue;
        socket.write(encodeText(JSON.stringify({ id: request.id, ...reply })));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        requests,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
