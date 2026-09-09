//! Tests for `detection.rs` (included via `#[path]`; split out of the
//! module so the file stays under its size baseline, matching every other
//! `ai_provider/` module).

use super::*;

#[test]
fn detect_with_maps_all_three_providers() {
    // Inject a checker that marks only `codex` available.
    let entries = detect_with(|cmd| {
        if cmd == "codex" {
            (true, Some("/usr/local/bin/codex".to_string()))
        } else {
            (false, None)
        }
    });

    assert_eq!(entries.len(), 3);
    let types: Vec<&str> = entries.iter().map(|e| e.provider_type.as_str()).collect();
    assert_eq!(types, ["claude", "codex", "gemini"]);

    let codex = entries.iter().find(|e| e.provider_type == "codex").unwrap();
    assert!(codex.available);
    assert_eq!(codex.path.as_deref(), Some("/usr/local/bin/codex"));

    let claude = entries
        .iter()
        .find(|e| e.provider_type == "claude")
        .unwrap();
    assert!(!claude.available);
    assert_eq!(claude.path, None);
    assert_eq!(claude.command, "claude");
    assert_eq!(claude.name, "Claude");
}

#[test]
fn env_keys_present_absent_and_empty() {
    // anthropic present, openai absent, google empty → only anthropic.
    let keys = read_env_api_keys_with(|var| match var {
        "ANTHROPIC_API_KEY" => Some("sk-ant".to_string()),
        "GOOGLE_API_KEY" => Some(String::new()), // empty → ignored
        _ => None,
    });
    assert_eq!(keys.get("anthropic").map(String::as_str), Some("sk-ant"));
    assert!(!keys.contains_key("openai"));
    assert!(!keys.contains_key("google-ai"));
}

#[test]
fn google_falls_back_to_gemini_var() {
    // GOOGLE_API_KEY unset/empty, GEMINI_API_KEY set → google-ai resolves.
    let keys = read_env_api_keys_with(|var| match var {
        "GOOGLE_API_KEY" => Some(String::new()),
        "GEMINI_API_KEY" => Some("gm-key".to_string()),
        _ => None,
    });
    assert_eq!(keys.get("google-ai").map(String::as_str), Some("gm-key"));
}

#[test]
fn google_prefers_google_var_over_gemini() {
    let keys = read_env_api_keys_with(|var| match var {
        "GOOGLE_API_KEY" => Some("goog".to_string()),
        "GEMINI_API_KEY" => Some("gem".to_string()),
        _ => None,
    });
    // First match wins → GOOGLE_API_KEY.
    assert_eq!(keys.get("google-ai").map(String::as_str), Some("goog"));
}

#[test]
fn env_keys_none_when_all_absent() {
    let keys = read_env_api_keys_with(|_| None);
    assert!(keys.is_empty());
}

// --- WI-1.1: login-shell ZDOTDIR resolution (terminal gap G1) ---
// (parse_sentinel unit tests live next to its definition in spawn.test.rs.)

#[test]
fn zdotdir_none_for_nonexistent_shell() {
    // Spawn failure must degrade to None, never panic.
    assert_eq!(query_login_shell_zdotdir("/no/such/shell/vmark-xyz"), None);
}

/// Exec a freshly written fixture once, before anything measures it.
///
/// macOS evaluates a freshly written, unsigned executable on its FIRST
/// `execve`, and that evaluation — not the shell — is the load-sensitive
/// part. Measured on this machine 2026-09-09: a cold first exec of one of
/// these scripts costs p50 409 ms, and under this suite's own load the
/// tail of the same operation reaches **1.65 s**; re-exec'ing the SAME
/// inode costs p50 9 ms / max 78 ms — a 45× reduction, because the
/// evaluation is already cached for it.
///
/// The bound this has to fit inside is production's 5 s
/// (`run_login_shell_capture`), which is not a test's to widen. So the
/// cold-start cost is taken OUT of the measured window instead: after the
/// warm-up, what the 5 s covers is a `printf`.
///
/// **This is a margin, not a proof.** 2500 replays of this exact capture
/// under the suite's own load never returned `None`, so the failure was never
/// reproduced in isolation and the cold-exec tail is the best available
/// explanation rather than a demonstrated one. What IS demonstrated is the
/// margin — worst measured capture ~1.65 s → ~78 ms against an unchanged 5 s
/// bound, roughly 3× headroom to 64×. The marker below is the part that does
/// not depend on that being right: whatever the cause, the next occurrence
/// names itself instead of being blamed on the round-trip.
///
/// # It is also the ETXTBSY readiness gate, and on Linux that is its whole job
///
/// CI's ubuntu leg failed here on 2026-09-09 with
/// `Os { code: 26, kind: ExecutableFileBusy }` while macOS and Windows passed.
/// That is the fork/exec race, not a broken fixture: `execve` returns ETXTBSY
/// while ANY process holds the file open for writing, and the writer here is
/// gone by this point (`drop(f)` precedes the call). The holder is a *forked
/// child of a sibling test* — `Command::spawn` forks, the child inherits every
/// descriptor including our still-open write fd, and although Rust opens files
/// `O_CLOEXEC` so the copy dies at the child's own `execve`, it is open for the
/// window between its `fork` and that `execve`. The cargo test harness runs
/// these tests on parallel threads, so that window overlaps ours.
///
/// The condition is therefore transient BY CONSTRUCTION — it clears when a
/// child that already exists finishes exec'ing, and nothing in this process can
/// reopen the fixture for writing afterwards — so retrying is not papering over
/// a defect. It is also why this helper must keep running on Linux even though
/// the macOS cold-start cost above does not exist there: a SUCCESSFUL exec here
/// proves no writer remains, which is what makes the real capture below safe.
/// Panicking on the first ETXTBSY, as this did, converts a self-clearing race
/// into a red build.
#[cfg(unix)]
fn warm_exec(shell: &std::path::Path) {
    // Bounded, and generous against a window that is normally sub-millisecond:
    // the child holding the descriptor is already running and only has to reach
    // its own execve. A cap rather than a spin so a genuinely busy file — a
    // real defect — still fails instead of hanging the suite.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let result = std::process::Command::new(shell)
            .arg("--vmark-warmup")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        match result {
            Ok(status) => {
                assert!(status.success(), "warm-up exec failed: {status:?}");
                return;
            }
            // ETXTBSY is 26 on both Linux and macOS; matched by raw errno
            // because `ErrorKind::ExecutableFileBusy` is not stable.
            Err(e) if e.raw_os_error() == Some(libc::ETXTBSY) => {
                assert!(
                    std::time::Instant::now() < deadline,
                    "fixture shell still ETXTBSY after 5s — a writer that never \
                     closed, not the fork/exec race this retries for"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(e) => panic!("warm-up exec of the fixture shell: {e:?}"),
        }
    }
}

/// Write a fake login "shell" that ignores its args, prints `body`, and
/// then records that it RAN TO COMPLETION. Returns the shell and that
/// marker.
///
/// The marker exists because `query_login_shell_zdotdir` funnels four
/// distinct outcomes into one `None` — spawn failure, non-zero exit, the
/// 5 s timeout, and a `try_wait` error — so `None` on its own cannot tell
/// "the shell ran and reported nothing" from "the shell never finished".
/// Both tests below turn on that difference and neither could see it. The
/// round-trip test was observed failing on 2026-09-09 (1 run in 14) with a
/// bare `left: None, right: Some(…)`, which names no cause at all — and the
/// cause was never recovered, because nothing recorded one. Its
/// `None`-expecting sibling carries the SAME defect wearing the opposite
/// sign, and that half is not a guess: with the marker assertion removed and
/// the capture bound mutated to zero, it PASSES while the shell is being
/// killed mid-run. A test that cannot fail on a broken capture is not
/// evidence that ZDOTDIR was unset.
///
/// Written LAST, after the `printf`, so its presence means the shell
/// reached the end: a killed or timed-out shell leaves no marker even
/// though it had already produced output. `: >` is a builtin redirect, so
/// the marker costs no extra process.
///
/// The `--vmark-warmup` branch exits before both. The real invocation is
/// `<shell> -lic <cmd>`, so `$1` is `-lic` and can never take it.
#[cfg(unix)]
fn write_fake_shell(
    dir: &tempfile::TempDir,
    body: &str,
) -> (std::path::PathBuf, std::path::PathBuf) {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let shell = dir.path().join("fakezsh");
    let ran = dir.path().join("fakezsh.ran");
    let mut f = std::fs::File::create(&shell).unwrap();
    write!(
        f,
        "#!/bin/sh\ncase \"$1\" in --vmark-warmup) exit 0;; esac\nprintf '{body}'\n: > '{marker}'\n",
        marker = ran.display()
    )
    .unwrap();
    drop(f);
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    warm_exec(&shell);
    assert!(
        !ran.exists(),
        "the warm-up must not count as a run, or the marker proves nothing"
    );
    (shell, ran)
}

/// The ETXTBSY retry, exercised against a REAL ETXTBSY.
///
/// # Linux only, and that is measured rather than assumed
///
/// **macOS does not enforce ETXTBSY**, so this cannot run there. Measured on
/// 2026-09-09 with a standalone probe: holding a write descriptor open on an
/// executable and then `execve`-ing it returns `Ok(ExitStatus(0))` on macOS,
/// while the same condition is what failed CI's ubuntu leg with
/// `Os { code: 26 }`. A `cfg(unix)` version of this test therefore asserts
/// nothing on the development machine — worse than nothing, as below.
///
/// # Why the fixture is warmed BEFORE the descriptor is held
///
/// The first version measured elapsed time across a COLD exec and passed with
/// the retry disabled: macOS's cold-start evaluation (the cost `warm_exec`'s
/// header documents at p50 409 ms) alone exceeded the threshold, so the timing
/// assertion was satisfied by the very latency this helper exists to remove.
/// Warming first puts that cost outside the measured window, leaving the retry
/// as the only thing a wait can be attributed to.
///
/// The elapsed-time assertion is the load-bearing half: without it this passes
/// whether or not ETXTBSY ever occurred, which is the shape of false pass this
/// file already documents twice.
#[cfg(target_os = "linux")]
#[test]
fn warm_exec_retries_through_etxtbsy() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let shell = dir.path().join("busyshell");
    let mut f = std::fs::File::create(&shell).unwrap();
    write!(f, "#!/bin/sh\nexit 0\n").unwrap();
    drop(f);
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

    // Pay any first-exec cost now, with no writer held, so it cannot be
    // mistaken for retry latency below.
    warm_exec(&shell);

    // Hold the file open for writing — precisely what execve refuses.
    let writer = std::fs::OpenOptions::new()
        .write(true)
        .open(&shell)
        .unwrap();
    let hold = std::time::Duration::from_millis(300);
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(hold);
        drop(writer);
    });

    let started = std::time::Instant::now();
    warm_exec(&shell); // must retry, not panic
    let waited = started.elapsed();
    releaser.join().unwrap();

    // Proves the retry loop actually ran. Compared against most of the hold
    // rather than all of it, so scheduler jitter around the release cannot
    // fail a working retry.
    assert!(
        waited >= hold / 2,
        "warm_exec returned in {waited:?} while the file was held open for \
         writing — ETXTBSY was never produced, so the retry path is untested"
    );
}

#[cfg(unix)]
#[test]
fn zdotdir_none_when_unset_in_login_shell() {
    // A fake shell that prints empty sentinels — deterministically models
    // "ZDOTDIR unset" regardless of this test process's environment, and
    // exercises the full spawn→capture→parse pipeline on the unset path.
    let dir = tempfile::tempdir().unwrap();
    let (shell, ran) = write_fake_shell(&dir, "__VMARK_ZDOTDIR_START____VMARK_ZDOTDIR_END__");

    let got = query_login_shell_zdotdir(shell.to_str().unwrap());

    // Both halves are load-bearing, and the marker comes FIRST: `None` is
    // equally what a shell that never finished produces, so without this
    // the test passed on exactly the failure it exists to distinguish from
    // an unset ZDOTDIR.
    assert!(
        ran.exists(),
        "the fake shell never ran to completion, so `None` says nothing \
         about an unset ZDOTDIR"
    );
    assert_eq!(got, None);
}

#[cfg(unix)]
#[test]
fn zdotdir_round_trips_via_fake_login_shell() {
    // A fake "shell" that prints a sentinel-wrapped value — exercises the
    // full spawn→capture→parse→non-empty path (closing the WI-1.1 coverage
    // gap) without racy/edition-fragile env mutation.
    let dir = tempfile::tempdir().unwrap();
    let (shell, ran) = write_fake_shell(
        &dir,
        "__VMARK_ZDOTDIR_START__/home/x/.config/zsh__VMARK_ZDOTDIR_END__",
    );

    let got = query_login_shell_zdotdir(shell.to_str().unwrap());

    // Name the real cause before blaming the round-trip: a capture that
    // never finished is not a parse defect, and reporting it as one is
    // what sent this test's failure to the wrong place.
    assert!(
        ran.exists(),
        "the fake shell never ran to completion — the capture failed, so \
         {got:?} says nothing about the round-trip"
    );
    assert_eq!(got.as_deref(), Some("/home/x/.config/zsh"));
}
