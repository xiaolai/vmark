/**
 * PTY wrapper — event-based replacement for tauri-pty.
 *
 * Purpose: Provides the same IPty interface as tauri-pty but uses Tauri events
 * (push-based) instead of invoke polling. Implements real pause/resume for
 * flow control. Two-phase startup eliminates data-loss race conditions.
 *
 * Key decisions:
 *   - Constructor returns immediately; the spawn is async. `ready` settles
 *     once the shell is running and REJECTS, with a readable `Error`, when the
 *     backend refuses or fails it — a caller's only way to fall back or tell
 *     the user.
 *   - Output flows over a binary `tauri::ipc::Channel` (ADR-T1): the
 *     reader thread sends `InvokeResponseBody::Raw(bytes)`, which the webview
 *     receives as an `ArrayBuffer` — NOT a JSON number array. This is ~3.66x
 *     less wire data and orders of magnitude less encode/decode CPU than the
 *     old `pty:data:` event path. The Channel
 *     is point-to-point, so output is no longer broadcast to every window.
 *   - The data Channel's `onmessage` is wired BEFORE `pty_start` is invoked, so
 *     the reader cannot emit before we are listening — no data-loss race
 *     (this replaces the old two-phase listen-then-start dance for output).
 *   - The exit signal stays a plain `pty:exit:{pid}` event (low-frequency).
 *   - `pause()` and `resume()` are real Tauri commands (not stubs), enabling
 *     the watermark-based flow control in spawnPty.ts.
 *   - `kill()` eagerly cleans up event listeners and guards against mid-setup
 *     races via a `_destroyed` flag; `write()` honours the same flag so a
 *     dispose-time flush after kill is dropped, not sent to a freed session.
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
import { commandErrorMessage } from "@/services/commands/commandError";
import { createPtyInputQueue } from "./ptyInputQueue";
import { EventEmitter, type IEvent } from "./ptyEvents";
export type { IEvent } from "./ptyEvents";

// ---------------------------------------------------------------------------
// Public types — match the tauri-pty interface that spawnPty.ts expects
// ---------------------------------------------------------------------------

interface IPtyExitEvent {
  exitCode: number;
}

export interface IPtySpawnOptions {
  codeBlock?: { shell: "powershell" | "cmd" | "python"; source: string };
  isDisposed?: () => boolean;
  claimCodeBlock?: () => boolean;
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface IPty {
  readonly pid: number;
  /** Resolves once the shell runs; rejects when it could not be spawned. */
  readonly ready: Promise<void>;
  cols: number;
  rows: number;
  readonly onData: IEvent<Uint8Array>;
  readonly onExit: IEvent<IPtyExitEvent>;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  pause(): void;
  resume(): void;
}

// ---------------------------------------------------------------------------
// VMarkPty — the concrete implementation
// ---------------------------------------------------------------------------

class VMarkPty implements IPty {
  private _pid = 0;
  cols: number;
  rows: number;

  private _onData = new EventEmitter<Uint8Array>();
  private _onExit = new EventEmitter<IPtyExitEvent>();
  readonly ready: Promise<void>;
  private _dataChannel: Channel<ArrayBuffer | Uint8Array | number[]> | null = null;
  private _unlistenExit: UnlistenFn | null = null;
  private _destroyed = false;
  private _input = createPtyInputQueue(async (data) => {
    await this.ready;
    if (!this._destroyed) await invoke("pty_write", { pid: this._pid, data });
  }, (error) => ptyWarn("pty_write failed:", commandErrorMessage(error)));
  /** Guards _freeRustSession so racing teardown paths can't double kill/close. */
  private _freed = false;

  get pid(): number {
    return this._pid;
  }

  constructor(file: string, args: string[], opts?: IPtySpawnOptions) {
    this.cols = opts?.cols ?? 80;
    this.rows = opts?.rows ?? 24;
    // A typed command rejection is a plain object; callers get an Error.
    this.ready = this._setup(file, args, opts).catch((err: unknown) => {
      throw new Error(commandErrorMessage(err), { cause: err });
    });
  }

  get onData(): IEvent<Uint8Array> {
    return this._onData.event;
  }
  get onExit(): IEvent<IPtyExitEvent> {
    return this._onExit.event;
  }

  private async _setup(file: string, args: string[], opts?: IPtySpawnOptions): Promise<void> {
    // Phase 1: create PTY + spawn child (reader NOT started yet)
    const spawnOptions = {
      file,
      cols: this.cols,
      rows: this.rows,
      cwd: opts?.cwd ?? null,
      env: opts?.env ?? {},
    };
    let initialCommand: string | undefined;
    if (opts?.codeBlock) {
      const created = await invoke<{ pid: number; command: string }>("pty_spawn_code_block", { ...spawnOptions, codeBlock: opts.codeBlock });
      this._pid = created.pid;
      initialCommand = created.command;
    } else {
      this._pid = await invoke<number>("pty_spawn", { ...spawnOptions, args });
    }

    // Everything after pty_spawn must free the Rust session on ANY failure
    // (listen, channel wiring, or pty_start) — otherwise the session created by
    // pty_spawn leaks its FDs/child handle (#974 class).
    try {
      // Exit is a low-frequency signal — keep it as a plain event.
      this._unlistenExit = await listen<{ exit_code: number }>(
        `pty:exit:${this._pid}`,
        (event) => {
          this._onExit.fire({ exitCode: event.payload.exit_code });
          this._cleanup();
          // Free the Rust-side session (FDs, memory)
          invoke("pty_close", { pid: this._pid }).catch((err) => {
            terminalLog("pty_close failed:", commandErrorMessage(err));
          });
        },
      );

      // Guard: if kill() was called while setup was in flight, abort.
      if (this._destroyed) {
        this._cleanup();
        await this._freeRustSession();
        return;
      }

      // Binary output Channel. Wiring onmessage before pty_start means the
      // reader cannot send before we are listening — no data-loss race.
      const channel = new Channel<ArrayBuffer | Uint8Array | number[]>();
      channel.onmessage = (msg) => {
        this._onData.fire(toUint8Array(msg));
      };
      this._dataChannel = channel;

      // Start the reader thread, handing it the channel as `onBytes`.
      await invoke("pty_start", { pid: this._pid, onBytes: channel });
      if (initialCommand) {
        if (this._destroyed || opts?.isDisposed?.()) throw new Error("disposed before code-block execution");
        if (opts?.claimCodeBlock && !opts.claimCodeBlock()) throw new Error("code block already dispatched");
        await invoke("pty_write", { pid: this._pid, data: initialCommand });
      }
    } catch (err) {
      this._cleanup();
      await this._freeRustSession();
      throw err;
    }
  }

  /** Best-effort, idempotent free of the Rust-side session (kill the child,
   *  drop the map entry). Safe to call on any setup-failure / teardown / kill
   *  path; the `_freed` guard prevents a double pty_kill/pty_close when several
   *  paths race (e.g. kill() during setup). */
  private async _freeRustSession(): Promise<void> {
    if (this._freed) return;
    this._freed = true;
    await invoke("pty_kill", { pid: this._pid }).catch((e) =>
      terminalLog("pty_kill failed:", commandErrorMessage(e)),
    );
    await invoke("pty_close", { pid: this._pid }).catch((e) =>
      terminalLog("pty_close failed:", commandErrorMessage(e)),
    );
  }

  write(data: string): void {
    this._input.write(data);
  }

  resize(columns: number, rows: number): void {
    this.cols = columns;
    this.rows = rows;
    this.ready
      .then(() => invoke("pty_resize", { pid: this._pid, cols: columns, rows }))
      .catch((err) => {
        ptyWarn("pty_resize failed:", commandErrorMessage(err));
      });
  }

  kill(): void {
    this._destroyed = true;
    this._cleanup();
    // _cleanup() removed the pty:exit listener, so the natural exit handler that
    // calls pty_close never runs (#974): free the Rust session explicitly. The
    // _freed guard makes this a no-op when setup's own destroyed-guard got
    // there first; a rejected `ready` means setup already freed whatever existed.
    this.ready
      .then(() => this._freeRustSession())
      .catch((err) => {
        terminalLog("kill after setup failure:", commandErrorMessage(err));
      });
  }

  pause(): void {
    this.ready
      .then(() => invoke("pty_pause", { pid: this._pid }))
      .catch((err) => {
        terminalLog("pty_pause failed:", commandErrorMessage(err));
      });
  }

  resume(): void {
    this.ready
      .then(() => invoke("pty_resume", { pid: this._pid }))
      .catch((err) => {
        terminalLog("pty_resume failed:", commandErrorMessage(err));
      });
  }

  private _cleanup(): void {
    this._input.close();
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
