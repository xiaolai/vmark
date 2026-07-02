/**
 * Shared Tauri automation-bridge client for VMark E2E harnesses.
 *
 * Purpose: One WebSocket request/response client over the debug-only
 * `tauri-plugin-mcp-bridge` automation socket (127.0.0.1:9323), extracted
 * from `e2e/smoke.mjs` so the smoke test and the journey suite share a
 * single verified implementation.
 *
 * Wire protocol (verified against tauri-plugin-mcp-bridge 0.8 `websocket.rs`):
 *   - Request:  { "id": "<unique>", "command": "<name>", "args": { ... } }
 *   - Response: { "id", "success": bool, "data"?: <json>, "error"?: <string> }
 *   - Commands used: list_windows, execute_js, capture_native_screenshot.
 *
 * Port 9323 ONLY. Port 9223 is VMark's own auth-protected MCP server —
 * commands sent there drop with "Connection closed".
 *
 * Zero runtime dependencies: Node's built-in global `WebSocket` (Node >= 22).
 */

/** Minimal request/response client over the bridge WebSocket. */
export class BridgeClient {
  #ws;
  #pending = new Map();
  #seq = 0;
  #idPrefix;

  /**
   * @param {{ idPrefix?: string }} [opts] Request-id prefix (helps when
   *   reading bridge logs from multiple harnesses).
   */
  constructor({ idPrefix = "e2e" } = {}) {
    this.#idPrefix = idPrefix;
  }

  connect({ host, port, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const url = `ws://${host}:${port}`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(new Error(`Failed to construct WebSocket for ${url}: ${err}`));
        return;
      }
      this.#ws = ws;

      const onTimeout = setTimeout(() => {
        reject(
          new Error(
            `Timed out connecting to the Tauri automation bridge at ${url} ` +
              `after ${timeoutMs}ms. Is the debug app running (pnpm tauri:dev)?`
          )
        );
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(onTimeout);
        resolve();
      });
      ws.addEventListener("error", (ev) => {
        clearTimeout(onTimeout);
        reject(
          new Error(
            `WebSocket error connecting to ${url}: ${ev?.message ?? ev}. ` +
              `Confirm the bridge is live on port ${port} (debug build only).`
          )
        );
      });
      ws.addEventListener("close", () => {
        // Reject any in-flight requests so callers don't hang.
        for (const [, p] of this.#pending) {
          p.reject(new Error("Bridge connection closed mid-request"));
        }
        this.#pending.clear();
      });
      ws.addEventListener("message", (ev) => this.#onMessage(ev));
    });
  }

  #onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return; // ignore non-JSON broadcast noise
    }
    // The bridge also broadcasts unsolicited events; only correlate replies
    // that carry an id we are waiting on.
    const id = msg?.id;
    if (id == null || !this.#pending.has(id)) return;
    const p = this.#pending.get(id);
    this.#pending.delete(id);
    p.resolve(msg);
  }

  send(command, args, timeoutMs) {
    const id = `${this.#idPrefix}-${++this.#seq}`;
    const payload = JSON.stringify({ id, command, args: args ?? {} });
    return new Promise((resolve, reject) => {
      const onTimeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (m) => {
          clearTimeout(onTimeout);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(onTimeout);
          reject(e);
        },
      });
      try {
        this.#ws.send(payload);
      } catch (err) {
        clearTimeout(onTimeout);
        this.#pending.delete(id);
        reject(new Error(`Failed to send "${command}": ${err}`));
      }
    });
  }

  close() {
    try {
      this.#ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Assert a bridge reply was successful; return its `.data`. */
export function expectSuccess(reply, label) {
  if (!reply || reply.success !== true) {
    throw new Error(
      `${label} — bridge returned failure: ${reply?.error ?? JSON.stringify(reply)}`
    );
  }
  return reply.data;
}

/** Run a JS expression in the webview and return its evaluated value. */
export async function evalJs(client, script, timeoutMs = 15000) {
  const reply = await client.send("execute_js", { script }, timeoutMs);
  if (reply.success !== true) {
    throw new Error(`execute_js failed: ${reply.error ?? JSON.stringify(reply)}`);
  }
  return reply.data;
}
