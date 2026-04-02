/**
 * PTY wrapper — event-based replacement for tauri-pty.
 *
 * Purpose: Provides the same IPty interface as tauri-pty but uses Tauri events
 * (push-based) instead of invoke polling. Implements real pause/resume for
 * flow control. Two-phase startup eliminates data-loss race conditions.
 *
 * Key decisions:
 *   - Constructor returns immediately; the actual spawn is async via `_ready`.
 *   - Event listeners are registered BEFORE `pty_start` is called, so no data
 *     is lost between spawn and first read.
 *   - `pause()` and `resume()` are real Tauri commands (not stubs), enabling
 *     the watermark-based flow control in spawnPty.ts.
 *   - Data arrives as `number[]` (JSON-serialized Vec<u8> from Rust) and is
 *     passed through as-is — the consumer (spawnPty.ts) handles coercion to
 *     Uint8Array.
 *   - `kill()` eagerly cleans up event listeners and guards against mid-setup
 *     races via a `_destroyed` flag.
 *   - `pty_close` is called after exit to free the Rust-side session (FDs).
 *
 * @coordinates-with src-tauri/src/pty.rs — Rust backend commands and events
 * @coordinates-with components/Terminal/spawnPty.ts — consumes this wrapper
 * @module lib/pty
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  private _unlistenData: UnlistenFn | null = null;
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

    // Phase 2: register event listeners
    this._unlistenData = await listen<number[]>(
      `pty:data:${this._pid}`,
      (event) => {
        this._onData.fire(event.payload);
      },
    );
    this._unlistenExit = await listen<{ exit_code: number }>(
      `pty:exit:${this._pid}`,
      (event) => {
        this._onExit.fire({ exitCode: event.payload.exit_code });
        this._cleanup();
        // Free the Rust-side session (FDs, memory)
        invoke("pty_close", { pid: this._pid }).catch(() => {});
      },
    );

    // Guard: if kill() was called while setup was in flight, abort
    if (this._destroyed) {
      this._cleanup();
      await invoke("pty_kill", { pid: this._pid }).catch(() => {});
      return;
    }

    // Phase 3: start the reader thread — listeners are ready, no data loss
    try {
      await invoke("pty_start", { pid: this._pid });
    } catch (err) {
      this._cleanup();
      throw err;
    }
  }

  write(data: string): void {
    this._ready
      .then(() => invoke("pty_write", { pid: this._pid, data }))
      .catch(() => {});
  }

  resize(columns: number, rows: number): void {
    this.cols = columns;
    this.rows = rows;
    this._ready
      .then(() =>
        invoke("pty_resize", { pid: this._pid, cols: columns, rows }),
      )
      .catch(() => {});
  }

  kill(): void {
    this._destroyed = true;
    this._cleanup();
    this._ready
      .then(() => invoke("pty_kill", { pid: this._pid }))
      .catch(() => {});
  }

  pause(): void {
    this._ready
      .then(() => invoke("pty_pause", { pid: this._pid }))
      .catch(() => {});
  }

  resume(): void {
    this._ready
      .then(() => invoke("pty_resume", { pid: this._pid }))
      .catch(() => {});
  }

  private _cleanup(): void {
    this._unlistenData?.();
    this._unlistenData = null;
    this._unlistenExit?.();
    this._unlistenExit = null;
  }
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
