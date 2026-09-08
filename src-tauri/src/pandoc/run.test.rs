//! Tests for `run.rs` — fake-executable lifecycle coverage for the
//! stdin/stderr concurrency and the timeout kill+reap paths.
//!
//! The fixtures are tiny `/bin/sh` scripts, so this whole module is
//! unix-only (Windows still compiles and runs the rest of the suite).
#![cfg(unix)]

use super::*;
use std::time::Instant;

fn write_script(dir: &std::path::Path, name: &str, body: &str) -> String {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, body).expect("write script");
    let mut perms = std::fs::metadata(&path)
        .expect("script metadata")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("chmod script");
    path.to_string_lossy().into_owned()
}

/// True while the OS still knows the pid (running OR zombie — a zombie is
/// exactly what an unreaped kill leaves behind).
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[test]
fn stderr_flood_before_stdin_read_does_not_deadlock() {
    let dir = tempfile::tempdir().expect("tempdir");
    // The child floods stderr (4x the ~64 KB pipe buffer) BEFORE reading any
    // stdin. A sequential implementation (write stdin fully, drain stderr
    // afterwards) deadlocks here: the child blocks writing stderr, the parent
    // blocks writing stdin, and the timeout loop never starts.
    let script = write_script(
        dir.path(),
        "stderr-flood.sh",
        "#!/bin/sh\nhead -c 262144 /dev/zero | tr '\\0' 'e' >&2\ncat > /dev/null\nexit 0\n",
    );
    let out = dir.path().join("out.docx").to_string_lossy().into_owned();
    // Larger than the stdin pipe buffer so the writer must block until the
    // child starts reading.
    let markdown = "x".repeat(256 * 1024);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(run_pandoc(
            &script,
            &markdown,
            &out,
            None,
            Duration::from_secs(60),
        ));
    });
    let result = rx
        .recv_timeout(Duration::from_secs(30))
        .expect("run_pandoc deadlocked (stdin written before the stderr drain started)");
    assert_eq!(result, Ok(()));
}

#[test]
fn retained_stderr_is_capped_on_failure() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = write_script(
        dir.path(),
        "stderr-then-fail.sh",
        "#!/bin/sh\nhead -c 262144 /dev/zero | tr '\\0' 'e' >&2\nexit 3\n",
    );
    let out = dir.path().join("out.docx").to_string_lossy().into_owned();
    let err = run_pandoc(&script, "input", &out, None, Duration::from_secs(60))
        .expect_err("exit 3 must surface as an error");
    assert!(
        err.len() <= MAX_STDERR_BYTES,
        "retained stderr not capped: {} bytes",
        err.len()
    );
    assert!(
        err.starts_with('e'),
        "error should carry the child's stderr, got: {}",
        &err[..err.len().min(80)]
    );
}

#[test]
fn timeout_kills_and_reaps_the_child() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pid_file = dir.path().join("child.pid");
    // The script records its own pid then blocks; `exec` keeps the pid.
    //
    // The `--vmark-warmup` branch exits immediately and writes nothing. It
    // exists for the warm-up exec below; `build_pandoc_args` starts the real
    // invocation with `-f`, so the real run can never take it.
    let script = write_script(
        dir.path(),
        "sleeper.sh",
        &format!(
            "#!/bin/sh\ncase \"$1\" in --vmark-warmup) exit 0;; esac\necho $$ > '{}'\nexec sleep 30\n",
            pid_file.display()
        ),
    );
    let out = dir.path().join("out.docx").to_string_lossy().into_owned();

    // WARM THE EXEC PATH before the timed run, or the timeout is racing macOS
    // rather than the child (measured 2026-09-09 on this machine): the FIRST
    // `execve` of a freshly written, unsigned file pays the system's
    // executable evaluation, and spawn→pid-file then costs p50 409ms / max
    // 622ms idle and **max 1.51s under this suite's own load** — against a 2s
    // budget. Re-exec'ing the same inode costs p50 9ms / max 78ms, a 45×
    // reduction, because the evaluation is already cached for it. That is the
    // whole flake: the kill was real and on time, the child had simply not
    // reached its first line yet, and the poll below then reported "child
    // never launched" — a launch failure that had not happened.
    std::process::Command::new(&script)
        .arg("--vmark-warmup")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("warm-up exec of the fixture script");
    assert!(
        !pid_file.exists(),
        "the warm-up must not launch the sleeper — it would hand the test a stale pid"
    );

    // Run on a thread so we can confirm the child actually launched (pid file
    // written) independently of the timeout.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(run_pandoc(
            &script,
            "input",
            &out,
            None,
            // A liveness bound, not a performance assertion: it only has to be
            // large enough that nothing but a HANG can consume it. With the
            // warm-up above the child reaches its first line in ~9ms, so 5s is
            // ~64× the measured worst case while still failing a wedged child
            // in seconds.
            Duration::from_secs(5),
        ));
    });

    // Poll until the child has written a parseable pid. If it never does, say
    // what actually happened — the run's OWN result — instead of asserting a
    // launch failure this loop cannot observe. An absent pid file means only
    // that the child did not reach its first line; it does not say why.
    let deadline = Instant::now() + Duration::from_secs(30);
    let pid: u32 = loop {
        if let Some(pid) = std::fs::read_to_string(&pid_file)
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            break pid;
        }
        if Instant::now() >= deadline {
            panic!(
                "no pid file after 30s; run_pandoc returned {:?}",
                rx.recv_timeout(Duration::from_secs(30))
            );
        }
        std::thread::sleep(Duration::from_millis(10));
    };

    let result = rx
        .recv_timeout(Duration::from_secs(30))
        .expect("run_pandoc never returned — timeout did not engage");
    assert!(result.is_err(), "sleeping child must time out");
    assert!(
        !pid_alive(pid),
        "child {pid} must be killed AND reaped (a zombie still has a pid entry)"
    );
}
