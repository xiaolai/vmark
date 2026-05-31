/**
 * PTY wrapper — event-based replacement for tauri-pty.
 *
 * Purpose: Provides the same IPty interface as tauri-pty but uses Tauri events
 * (push-based) instead of invoke polling. Implements real pause/resume for
 * flow control. Two-phase startup eliminates data-loss race conditions.
 *
 * Key decisions:
 *   - Constructor returns immediately; the actual spawn is async via `_ready`.
 *   - Output flows over a binary `tauri::ipc::Channel` (WI-1.1, ADR-T1): the
 *     reader thread sends `InvokeResponseBody::Raw(bytes)`, which the webview
 *     receives as an `ArrayBuffer` — NOT a JSON number array. This is ~3.66x
 *     less wire data and orders of magnitude less encode/decode CPU than the
 *     old `pty:data:` event path (see dev-docs/grills/terminal/). The Channel
 *     is point-to-point, so output is no longer broadcast to every window.
 *   - The data Channel's `onmessage` is wired BEFORE `pty_start` is invoked, so
 *     the reader cannot emit before we are listening — no data-loss race
 *     (this replaces the old two-phase listen-then-start dance for output).
 *   - The exit signal stays a plain `pty:exit:{pid}` event (low-frequency).
 *   - `pause()` and `resume()` are real Tauri commands (not stubs), enabling
 *     the watermark-based flow control in spawnPty.ts.
 *   - `kill()` eagerly cleans up event listeners and guards against mid-setup
 *     races via a `_destroyed` flag.
 *   - `pty_close` frees the Rust-side session (FDs/channels/child handle). It
 *     runs from the exit handler on natural exit; but because `kill()` (and the
 *     mid-setup guard) tear down the exit listener first, those paths call
 *     `pty_close` directly so the session is never leaked (#974).
 *
 * @coordinates-with src-tauri/src/pty.rs — Rust backend commands and events
 * @coordinates-with components/Terminal/spawnPty.ts — consumes this wrapper
 * @module lib/pty
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ptyWarn, terminalLog } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

// ---------------------------------------------------------------------------
// Public types — match the tauri-pty interface that spawnPty.ts expects
// ---------------------------------------------------------------------------

export interface IDisposable {
  dispose(): void;
}

export type IEvent<T> = (listener: (data: T) => void) => IDisposable;

export interface IPtyExitEvent {
  exitCode: number;
}

export interface IPtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface IPty {
  readonly pid: number;
  cols: number;
  rows: number;
  readonly onData: IEvent<Uint8Array | number[]>;
  readonly onExit: IEvent<IPtyExitEvent>;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  pause(): void;
  resume(): void;
}

// ---------------------------------------------------------------------------
// EventEmitter — minimal pub/sub
// ---------------------------------------------------------------------------

class EventEmitter<T> {
  private _listeners: Array<(data: T) => void> = [];

  get event(): IEvent<T> {
    return (listener) => {
      this._listeners.push(listener);
      return {
        dispose: () => {
          const idx = this._listeners.indexOf(listener);
          if (idx >= 0) this._listeners.splice(idx, 1);
        },
      };
    };
  }

  fire(data: T): void {
    for (const fn of [...this._listeners]) {
      fn(data);
    }
  }
}

// ---------------------------------------------------------------------------
// VMarkPty — the concrete implementation
// ---------------------------------------------------------------------------

class VMarkPty implements IPty {
  private _pid = 0;
  cols: number;
  rows: number;

  private _onData = new EventEmitter<Uint8Array | number[]>();
  private _onExit = new EventEmitter<IPtyExitEvent>();
  private _ready: Promise<void>;
  private _dataChannel: Channel<ArrayBuffer | Uint8Array | number[]> | null = null;
  private _unlistenExit: UnlistenFn | null = null;
  private _destroyed = false;

  get pid(): number {
    return this._pid;
  }

  constructor(file: string, args: string[], opts?: IPtySpawnOptions) {
    this.cols = opts?.cols ?? 80;
    this.rows = opts?.rows ?? 24;
    this._ready = this._setup(file, args, opts);
  }

  get onData(): IEvent<Uint8Array | number[]> {
    return this._onData.event;
  }
  get onExit(): IEvent<IPtyExitEvent> {
    return this._onExit.event;
  }

  private async _setup(
    file: string,
    args: string[],
    opts?: IPtySpawnOptions,
  ): Promise<void> {
    // Phase 1: create PTY + spawn child (reader NOT started yet)
    this._pid = await invoke<number>("pty_spawn", {
      file,
      args,
      cols: this.cols,
      rows: this.rows,
      cwd: opts?.cwd ?? null,
      env: opts?.env ?? {},
    });

    // Exit is a low-frequency signal — keep it as a plain event.
    this._unlistenExit = await listen<{ exit_code: number }>(
      `pty:exit:${this._pid}`,
      (event) => {
        this._onExit.fire({ exitCode: event.payload.exit_code });
        this._cleanup();
        // Free the Rust-side session (FDs, memory)
        invoke("pty_close", { pid: this._pid }).catch((err) => {
          terminalLog("pty_close failed:", errorMessage(err));
        });
      },
    );

    // Guard: if kill() was called while setup was in flight, abort
    if (this._destroyed) {
      this._cleanup();
      await invoke("pty_kill", { pid: this._pid }).catch((err) => {
        terminalLog("pty_kill (setup guard) failed:", errorMessage(err));
      });
      // Listeners were torn down, so the exit handler won't free the session
      // (#974). Close it explicitly here too.
      await invoke("pty_close", { pid: this._pid }).catch((err) => {
        terminalLog("pty_close (setup guard) failed:", errorMessage(err));
      });
      return;
    }

    // Binary output Channel. Wiring onmessage before pty_start means the reader
    // cannot send before we are listening — no data-loss race (WI-1.1).
    const channel = new Channel<ArrayBuffer | Uint8Array | number[]>();
    channel.onmessage = (msg) => {
      this._onData.fire(toUint8Array(msg));
    };
    this._dataChannel = channel;

    // Start the reader thread, handing it the channel as `onBytes`.
    try {
      await invoke("pty_start", { pid: this._pid, onBytes: channel });
    } catch (err) {
      this._cleanup();
      throw err;
    }
  }

  write(data: string): void {
    this._ready
      .then(() => invoke("pty_write", { pid: this._pid, data }))
      .catch((err) => {
        ptyWarn("pty_write failed:", errorMessage(err));
      });
  }

  resize(columns: number, rows: number): void {
    this.cols = columns;
    this.rows = rows;
    this._ready
      .then(() =>
        invoke("pty_resize", { pid: this._pid, cols: columns, rows }),
      )
      .catch((err) => {
        ptyWarn("pty_resize failed:", errorMessage(err));
      });
  }

  kill(): void {
    this._destroyed = true;
    this._cleanup();
    // _cleanup() removed the pty:exit listener, so the natural exit handler
    // that calls pty_close never runs (#974). Close the Rust session
    // explicitly after pty_kill — in finally so a failed kill still frees the
    // session map entry (FDs, channels, child handle).
    this._ready
      .then(() => invoke("pty_kill", { pid: this._pid }))
      .catch((err) => {
        terminalLog("pty_kill failed:", errorMessage(err));
      })
      .finally(() => {
        invoke("pty_close", { pid: this._pid }).catch((err) => {
          terminalLog("pty_close failed:", errorMessage(err));
        });
      });
  }

  pause(): void {
    this._ready
      .then(() => invoke("pty_pause", { pid: this._pid }))
      .catch((err) => {
        terminalLog("pty_pause failed:", errorMessage(err));
      });
  }

  resume(): void {
    this._ready
      .then(() => invoke("pty_resume", { pid: this._pid }))
      .catch((err) => {
        terminalLog("pty_resume failed:", errorMessage(err));
      });
  }

  private _cleanup(): void {
    // The Channel has no "unlisten"; drop its onmessage so no further bytes
    // reach the (disposed) consumer, and release the reference.
    if (this._dataChannel) {
      this._dataChannel.onmessage = () => {};
      this._dataChannel = null;
    }
    this._unlistenExit?.();
    this._unlistenExit = null;
  }
}

/** Coerce a Channel payload to a Uint8Array. Raw bodies arrive as ArrayBuffer;
 *  the other branches are defensive (a typed-array view or a JSON number[]). */
function toUint8Array(msg: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (msg instanceof Uint8Array) return msg;
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (ArrayBuffer.isView(msg)) {
    const view = msg as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(msg);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function spawn(
  file: string,
  args: string[] | string,
  options?: IPtySpawnOptions,
): IPty {
  const argArray = typeof args === "string" ? [args] : args;
  return new VMarkPty(file, argArray, options);
}
