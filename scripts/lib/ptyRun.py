#!/usr/bin/env python3
"""Run a command under a pseudo-terminal, type input, stream the transcript.

Used by scripts/shell-integration-smoke.test.mjs (WI-FL5.11) to drive a REAL
interactive zsh/bash the way a terminal emulator would. `script(1)` was the
first attempt and is unusable here: BSD `script` forwards a non-tty stdin as an
immediate EOT (the shell reads ^D before the typed lines), and the util-linux
dialect has different flags. Python's pty module is present on every macOS and
ubuntu runner and behaves identically on both.

usage: ptyRun.py --cwd DIR --input TEXT [--timeout SECONDS] -- CMD [ARGS...]

The child inherits this process's environment (the caller shapes it). Stdout
receives the raw transcript bytes AS THEY ARRIVE — nothing is buffered here, so
a noisy child cannot grow this process; the caller bounds what it keeps. The
exit status is the child's (a signal death is 128 + signo, the shell
convention), or 124 on timeout — in which case the child's whole PROCESS
GROUP is terminated (SIGTERM, then SIGKILL) and reaped, so a background job
it started does not outlive the run. The group outlives its leader: a
descendant that ignores SIGTERM is still in it after the shell has died, so
the escalation to SIGKILL is decided by whether the GROUP is empty, never by
whether the direct child has exited. Input is written non-blocking against
the same deadline, partial writes and all, so a child that never reads stdin
cannot wedge the driver; a child that closes its pty but lingers is still
bounded by the deadline. Dependency-free by design: the gates tier must not
need node-pty. Self-tested by scripts/lib/ptyRun.test.mjs.
"""
import argparse
import errno
import math
import os
import pty
import select
import signal
import sys
import time

READ_CHUNK = 65536
POLL_S = 0.1


def positive_seconds(text):
    """A FINITE, positive number of seconds.

    `type=float` accepted `0`, `-1`, `nan` and `inf`. Each breaks the contract
    this module's header states — the run is bounded and the child's group is
    reaped: zero and negative time out before the child can be spawned's worth
    of output arrives, `nan` compares false against every deadline so the loop
    exits immediately, and `inf` removes the bound altogether, which is the one
    thing a driver used by a test suite must never do (audit R2 #187).
    """
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError(f"--timeout must be a finite positive number of seconds, got {text!r}")
    return value


def parse_args(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cwd", required=True)
    ap.add_argument("--input", default="")
    ap.add_argument("--timeout", type=positive_seconds, default=15.0)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args(argv)
    args.cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    return args


def spawn(cmd, cwd):
    """Fork the child under a pty; it becomes a session leader, so its pgid is its pid."""
    pid, fd = pty.fork()
    if pid == 0:  # child
        os.chdir(cwd)
        os.execvp(cmd[0], cmd)
    os.set_blocking(fd, False)
    return pid, fd


def write_some(fd, pending):
    """One non-blocking write; returns what is still unsent (a partial write is normal on a pty)."""
    try:
        return pending[os.write(fd, pending):]
    except BlockingIOError:
        return pending
    except OSError as err:
        if err.errno == errno.EIO:  # the slave side is gone: nothing will read this
            return b""
        raise


def read_some(fd):
    """One chunk; b"" at EOF (or Linux's EIO once the slave closes); None when nothing is readable yet."""
    try:
        return os.read(fd, READ_CHUNK)
    except BlockingIOError:
        return None
    except OSError as err:
        if err.errno == errno.EIO:
            return b""
        raise


def reap(pid):
    """(exited, wait status) without blocking."""
    done, status = os.waitpid(pid, os.WNOHANG)
    return done != 0, status


def drain(fd, out, budget=0.5):
    """After exit: copy what is still buffered in the pty, briefly."""
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.05)
        if not readable:
            return
        chunk = read_some(fd)
        if not chunk:
            return
        out.write(chunk)
        out.flush()


def drive(pid, fd, pending, timeout, out):
    """Feed input and stream output until the child exits (its wait status) or the deadline passes (None).

    The child is reaped on EVERY iteration, including ones that read data. The
    `continue` that used to skip the reap while output flowed meant a child
    that had already exited — with descendants still writing to the pty, or
    simply a lot of buffered output — was never noticed, and the run was
    reported as a TIMEOUT with a real exit status available the whole time
    (audit R2 #188).
    """
    deadline = time.monotonic() + timeout
    eof = False
    while time.monotonic() < deadline:
        readable, writable, _ = select.select([] if eof else [fd], [fd] if pending and not eof else [], [], POLL_S)
        if writable:
            pending = write_some(fd, pending)
        read_data = False
        if readable:
            chunk = read_some(fd)
            if chunk:
                out.write(chunk)
                out.flush()
                read_data = True
            elif chunk == b"":
                eof = True
        exited, status = reap(pid)
        if exited:
            if not eof:
                drain(fd, out)
            return status
        # Data is still flowing and the child is alive: go straight back to the
        # descriptor rather than waiting out another poll interval.
        if read_data:
            continue
        # An EOF with a live child (it closed its pty and lingers): keep polling
        # the child, not the fd, until it exits or the deadline says otherwise.
    return None


def group_alive(pgid):
    """Is any process left in the group? (`kill -0` on a group: ESRCH once it is empty.)"""
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def terminate(pid):
    """Stop the child's whole process group and reap the child: SIGTERM with a
    grace period, then SIGKILL to whatever is LEFT IN THE GROUP. The direct
    child exiting is not the end condition — a grandchild that ignored SIGTERM
    (`trap '' TERM`) survived the old version because the loop returned the
    moment the shell died, and SIGKILL was never sent."""
    status = None
    for sig, grace in ((signal.SIGTERM, 1.0), (signal.SIGKILL, 5.0)):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            pass
        until = time.monotonic() + grace
        while time.monotonic() < until:
            if status is None:
                exited, st = reap(pid)
                if exited:
                    status = st
            if status is not None and not group_alive(pid):
                return status
            time.sleep(0.02)
    if status is None:
        status = os.waitpid(pid, 0)[1]
    return status


def exit_status(status):
    """Shell convention: the exit code, or 128 + signo for a signal death — never a negative number modulo 256."""
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def main(argv):
    args = parse_args(argv)
    if not args.cmd:
        print("ptyRun.py: no command given", file=sys.stderr)
        return 64
    pid, fd = spawn(args.cmd, args.cwd)
    reaped = False
    try:
        status = drive(pid, fd, args.input.encode("utf-8"), args.timeout, sys.stdout.buffer)
        if status is None:
            terminate(pid)
            reaped = True
            return 124
        reaped = True
        return exit_status(status)
    finally:
        # The GROUP guarantee has to hold on the exceptional path too. An
        # error out of select, the pty, or a transcript write used to reach a
        # `finally` that closed the master fd and did nothing else — so the
        # child and every descendant it had started outlived the run, which is
        # exactly what this module's header promises cannot happen (audit R2
        # #189). `reaped` distinguishes "drive() already collected the child"
        # from "we are unwinding"; terminate() is idempotent enough to be safe
        # either way, but calling it twice would block on a second waitpid.
        if not reaped:
            try:
                terminate(pid)
            except OSError:
                pass  # already gone; the close below still has to happen
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
