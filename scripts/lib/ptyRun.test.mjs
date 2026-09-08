// The pty driver behind the shell-integration smoke test, exercised with real
// shells: exit-status mapping, input delivery, and — the two ways it used to
// hang — a child that closes its pty but lingers, and a timeout that left a
// background job alive.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DRIVER = resolve(import.meta.dirname, "ptyRun.py");

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function drive(argv, { input = "", timeout = 15 } = {}) {
  if (!which("python3")) throw new Error("python3 is not installed; the pty driver needs it");
  const started = Date.now();
  const r = spawnSync("python3", [DRIVER, "--cwd", mkdtempSync(join(tmpdir(), "ptyrun-")), "--input", input, "--timeout", String(timeout), "--", ...argv], {
    encoding: "latin1",
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { status: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - started };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
};

describe.skipIf(platform() === "win32")("scripts/lib/ptyRun.py", () => {
  it("exits 64 with no command", () => {
    expect(drive([]).status).toBe(64);
  });

  it("returns the child's exit code, and 128 + signo for a signal death (not 241 for SIGTERM)", () => {
    expect(drive(["sh", "-c", "exit 3"]).status).toBe(3);
    expect(drive(["sh", "-c", "kill -TERM $$"]).status).toBe(143);
  });

  it("delivers input larger than one pty write and streams the transcript", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line-${String(i).padStart(4, "0")}`);
    const r = drive(["cat"], { input: `${lines.join("\n")}\n\x04` });
    expect(r.status).toBe(0);
    expect(r.out).toContain("line-0000");
    expect(r.out).toContain("line-0399");
  });

  it("does not wedge on a child that never reads its input", () => {
    const r = drive(["sh", "-c", "exit 7"], { input: "x".repeat(8000) + "\n", timeout: 10 });
    expect(r.status).toBe(7);
    expect(r.ms).toBeLessThan(8_000);
  });

  it("a child that closes its pty but keeps running is bounded by the timeout, not waited on forever", () => {
    const r = drive(["sh", "-c", "exec >/dev/null 2>&1 </dev/null; sleep 30"], { timeout: 1 });
    expect(r.status).toBe(124);
    expect(r.ms).toBeLessThan(15_000);
  });

  it("a timeout terminates the child's whole process group — a background job does not outlive the run", () => {
    const r = drive(["sh", "-c", "sleep 30 & echo BG=$!; wait"], { timeout: 1 });
    expect(r.status).toBe(124);
    const bg = /BG=(\d+)/.exec(r.out);
    expect(bg, r.out).not.toBeNull();
    expect(alive(Number(bg[1]))).toBe(false);
  });

  // audit R2 #188 — `drive` now reaps on EVERY iteration, including ones that
  // read data; the `continue` that skipped the reap could starve it while
  // output flowed and report an exited child as a TIMEOUT. This is a
  // regression guard, not a RED receipt: measured against the pre-fix driver
  // with a descendant flooding the pty, both report 5, because the reader
  // outpaces any writer and a gap — hence a reap — always appears. Keep it so
  // a future rewrite that DOES starve the reap fails here.
  it("reports the exited child's status even while a descendant floods the pty", () => {
    const flood = "(i=0; while [ $i -lt 20000 ]; do echo vmark-noise; i=$((i+1)); done) &";
    const r = drive(["sh", "-c", `${flood} sleep 0.1; exit 5`], { timeout: 3 });
    expect(r.status).toBe(5);
    expect(r.out).toContain("vmark-noise");
    expect(r.ms).toBeLessThan(10_000);
  });

  // audit R2 #187 — `type=float` accepted every value that breaks the bound
  // this driver's contract is built on.
  it.each(["0", "-1", "nan", "inf", "-inf"])("refuses --timeout %s instead of running unbounded or not at all", (t) => {
    // `--timeout=<v>`: argparse reads a bare `-inf` as an option, not a value.
    const r = spawnSync("python3", [DRIVER, "--cwd", tmpdir(), `--timeout=${t}`, "--", "/bin/echo", "hi"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("finite positive number of seconds");
    expect(r.stdout).not.toContain("hi");
  });

  // audit R2 #189 — the group guarantee held only on the two planned exits.
  // An error out of select, the pty or a transcript write reached a `finally`
  // that closed the master fd and did nothing else, so the child and every
  // descendant it had started outlived the run. The failure is INJECTED
  // because a real one cannot be provoked on demand: `read_some` is replaced
  // with one that emits its chunk and then raises.
  it("terminates the process group when the driver itself fails, not only on a clean exit or a timeout", () => {
    const script = [
      "import importlib.util, sys",
      `spec = importlib.util.spec_from_file_location('ptyrun', ${JSON.stringify(DRIVER)})`,
      "m = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(m)",
      "original = m.read_some",
      "def boom(fd):",
      "    data = original(fd)",
      "    if data and b'BG=' in data:",
      "        sys.stdout.buffer.write(data)",
      "        sys.stdout.buffer.flush()",
      "        raise RuntimeError('injected transcript failure')",
      "    return data",
      "m.read_some = boom",
      "try:",
      "    m.main(sys.argv[1:])",
      "except RuntimeError as e:",
      "    print('RAISED:%s' % e)",
    ].join("\n");
    const r = spawnSync(
      "python3",
      ["-c", script, "--cwd", mkdtempSync(join(tmpdir(), "ptyrun-boom-")), "--input", "", "--timeout", "20",
        // The descendant IGNORES SIGHUP. Closing the master fd hangs up the
        // pty and the kernel signals the foreground group, which is why a
        // plain `sleep 30 &` dies either way and proves nothing; only the
        // explicit SIGTERM-then-SIGKILL to the GROUP ends this one.
        "--", "sh", "-c", "(trap '' HUP; exec sleep 30) & echo BG=$!; wait"],
      { encoding: "latin1", timeout: 60_000 },
    );
    expect(r.stdout, r.stderr).toContain("RAISED:injected transcript failure");
    const bg = /BG=(\d+)/.exec(r.stdout);
    expect(bg, r.stdout).not.toBeNull();
    expect(alive(Number(bg[1]))).toBe(false);
  });

  it("escalates to SIGKILL for a descendant that ignores SIGTERM even after the direct child has exited (audit #96)", () => {
    // The shell dies on SIGTERM; its background child has TERM ignored and
    // execs sleep with that disposition, so only SIGKILL to the GROUP ends it.
    const r = drive(["sh", "-c", "(trap '' TERM; exec sleep 30) & echo BG=$!; wait"], { timeout: 1 });
    expect(r.status).toBe(124);
    const bg = /BG=(\d+)/.exec(r.out);
    expect(bg, r.out).not.toBeNull();
    expect(alive(Number(bg[1]))).toBe(false);
    expect(r.ms).toBeLessThan(15_000);
  });
});
