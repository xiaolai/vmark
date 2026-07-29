/**
 * Auth handshake state for one connection attempt.
 *
 * VMark answers the `auth` frame with `auth_result`, which arrives on the
 * message handler — so the connect() promise has to be parked here until then.
 * The three fields move as a unit (resolve, reject, timeout timer); every exit
 * path clears all three before running its callback, so a late `auth_result`,
 * a socket close, and the timeout can never settle the same attempt twice.
 */

export interface AuthHandshakeHandlers {
  /**
   * The handshake timed out. Runs BEFORE `onFailure` and is where the
   * attempt-local socket is closed — never `this.ws`, which may already belong
   * to a newer attempt.
   */
  onTimeout: () => void;
  /** `auth_result` reported success. */
  onSuccess: () => void;
  /** The handshake failed; `reason` is surfaced to the connect() caller. */
  onFailure: (reason: string) => void;
}

export class AuthHandshake {
  private resolveFn: (() => void) | null = null;
  private rejectFn: ((reason: string) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Reject and clear stale auth callbacks from a previous connection attempt.
   * Called at the top of every connect() so a superseded attempt cannot later
   * settle — or wedge — the new one.
   */
  supersede(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.rejectFn) {
      this.rejectFn('Connection superseded by new attempt');
    }
    this.resolveFn = null;
    this.rejectFn = null;
  }

  /**
   * Arm the handshake after the `auth` frame has been written.
   *
   * Bound the wait for auth_result so a missing reply (serialization
   * failure on Rust side, sender-task hang, etc.) cannot wedge the
   * connect() Promise — and therefore the reconnect loop — forever.
   */
  arm(timeoutMs: number, handlers: AuthHandshakeHandlers): void {
    const timer = setTimeout(() => {
      if (!this.rejectFn) {
        return;
      }
      this.resolveFn = null;
      this.rejectFn = null;
      this.timer = null;
      handlers.onTimeout();
      handlers.onFailure('Auth handshake timeout');
    }, timeoutMs);
    this.timer = timer;

    // Wait for auth_result before marking connected.
    // The message handler settles these via settle().
    this.resolveFn = () => {
      clearTimeout(timer);
      this.timer = null;
      handlers.onSuccess();
    };
    this.rejectFn = (reason: string) => {
      clearTimeout(timer);
      this.timer = null;
      handlers.onFailure(reason);
    };
  }

  /**
   * Settle from the payload of an incoming `auth_result` frame. No-op when no
   * handshake is armed (a stray or duplicate result).
   */
  settleFromResult(payload: unknown): void {
    const success = (payload as { success?: boolean })?.success;
    if (success && this.resolveFn) {
      this.resolveFn();
      this.resolveFn = null;
      this.rejectFn = null;
    } else if (this.rejectFn) {
      const error = (payload as { error?: string })?.error ?? 'Unknown auth error';
      this.rejectFn(error);
      this.resolveFn = null;
      this.rejectFn = null;
    }
  }

  /**
   * Fail an in-flight handshake because the socket went away under it.
   */
  abort(reason: string): void {
    if (this.rejectFn) {
      this.rejectFn(reason);
    }
    this.resolveFn = null;
    this.rejectFn = null;
  }
}
