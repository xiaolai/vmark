/**
 * Newline-delimited JSON-RPC over a child process's stdio.
 *
 * Extracted from `startVmarkMcp`, which had grown to hold the framing, the
 * pending-request map, the handshake and the tool wrappers at once. Three
 * defects were living in the part that is now here, and all three were
 * invisible from the outside:
 *
 *   - **Unparseable stdout lines were discarded in silence.** The comment said
 *     "non-protocol noise", and that is usually true — but a MALFORMED protocol
 *     frame looks identical, and the symptom is a request that times out with
 *     no reason given. Noise is now kept and surfaced in the timeout message.
 *   - **Requests were written to a dead process.** `child.stdin.write()` after
 *     the sidecar exited raises EPIPE on a stream nobody is listening to, so a
 *     crashed sidecar produced an unhandled error rather than the diagnosis it
 *     already had in `stderr`. A send after exit now rejects immediately, with
 *     the exit code and stderr.
 *   - **A reply arriving for an id nobody is waiting on was dropped.** Same
 *     shape as the first: it is either a late reply to a timed-out request
 *     (harmless) or a framing bug (not), and nothing recorded which.
 *
 * Split out to be TESTABLE, not merely shorter: it needs only an object with
 * `stdin`/`stdout`/`stderr`, so `jsonRpcStdio.test.mjs` drives every branch
 * without spawning anything.
 *
 * @module e2e/lib/jsonRpcStdio
 */
import { once } from "node:events";

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {{ timeoutMs: number }} opts
 */
export function createStdioChannel(child, { timeoutMs }) {
  const pending = new Map();
  /** Lines on stdout that were not protocol frames, kept for diagnostics. */
  const noise = [];
  let nextId = 1;
  let buf = "";
  let exit = null;
  let stderrBuf = "";

  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  // MCP stdio framing is newline-delimited JSON — NOT LSP-style Content-Length.
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        noise.push(line);
        continue;
      }
      const entry = pending.get(msg.id);
      if (!entry) {
        // A reply nobody is waiting for: a late answer to a timed-out request,
        // or a framing bug. Recorded either way — dropping it is how the second
        // one stays invisible.
        noise.push(line);
        continue;
      }
      pending.delete(msg.id);
      entry.resolve(msg);
    }
  });

  const exited = once(child, "exit").then(([code]) => {
    exit = { code };
    for (const [, p] of pending) {
      p.reject(new Error(describeExit(`exited mid-request`, code)));
    }
    pending.clear();
    return code;
  });

  function describeExit(what, code) {
    const parts = [`sidecar ${what} (code ${code})`];
    if (stderrBuf.trim()) parts.push(`stderr:\n${stderrBuf.trim()}`);
    if (noise.length) parts.push(`unmatched stdout:\n${noise.join("\n")}`);
    return parts.join("\n");
  }

  function writeFrame(payload) {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  /** Send a request and resolve its reply message. */
  function send(method, params) {
    // Refused rather than written: `write()` on a dead process's stdin raises
    // EPIPE asynchronously, which loses the exit code and the stderr that
    // explain WHY it died.
    if (exit !== null) {
      return Promise.reject(new Error(describeExit(`is not running; cannot send ${method}`, exit.code)));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const parts = [`MCP ${method} timed out after ${timeoutMs}ms.`];
        if (stderrBuf.trim()) parts.push(`stderr:\n${stderrBuf.trim()}`);
        // The whole reason noise is kept: a malformed frame and a silent
        // sidecar produce the same timeout, and only this tells them apart.
        if (noise.length) parts.push(`unmatched stdout:\n${noise.join("\n")}`);
        reject(new Error(parts.join("\n")));
      }, timeoutMs);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      writeFrame({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Send a notification (no id, no reply). */
  function notify(method, params) {
    if (exit !== null) return;
    writeFrame({ jsonrpc: "2.0", method, params });
  }

  /** End stdin, then wait for exit — SIGKILL if it will not go. */
  async function close({ killAfterMs = 3000 } = {}) {
    try {
      child.stdin.end();
    } catch {
      /* already gone */
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    await exited.catch(() => {});
    clearTimeout(timer);
  }

  return {
    send,
    notify,
    close,
    stderr: () => stderrBuf,
    noise: () => [...noise],
    hasExited: () => exit !== null,
  };
}
