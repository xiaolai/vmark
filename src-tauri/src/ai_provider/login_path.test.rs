//! A failed PATH probe stays visible and retryable, and a good PATH survives a
//! failed retry (#1628).

use super::*;
use std::cell::Cell;

fn failure(reason: ProbeReason) -> ProbeFailure {
    ProbeFailure {
        shell: "zsh".to_string(),
        reason,
    }
}

const INHERITED: &str = "/usr/bin:/bin";
const LOGIN: &str = "/opt/homebrew/bin:/usr/bin:/bin";

fn inherited() -> String {
    INHERITED.to_string()
}

fn timed_out() -> Result<String, ProbeFailure> {
    Err(failure(ProbeReason::Timeout))
}

fn probed() -> Result<String, ProbeFailure> {
    Ok(LOGIN.to_string())
}

#[test]
fn nothing_is_reported_before_the_first_probe() {
    assert_eq!(PathCache::new().fallback(), None);
}

#[test]
fn a_successful_probe_serves_every_later_reader_without_probing_again() {
    let cache = PathCache::new();
    let probes = Cell::new(0);
    for _ in 0..3 {
        let path = cache.current(
            || {
                probes.set(probes.get() + 1);
                probed()
            },
            inherited,
        );
        assert_eq!(path, LOGIN);
    }
    assert_eq!(probes.get(), 1);
    assert_eq!(cache.fallback(), None);
}

#[test]
fn a_failed_probe_serves_the_inherited_path_and_says_so() {
    let cache = PathCache::new();
    assert_eq!(cache.current(timed_out, inherited), INHERITED);
    assert_eq!(
        cache.fallback(),
        Some(LoginPathFallback {
            shell: "zsh".to_string(),
            reason: ProbeReason::Timeout,
            path: INHERITED.to_string(),
        })
    );
}

/// A broken shell must cost one bounded probe, not five seconds per reader:
/// pandoc, the terminal and every AI call read this path.
#[test]
fn readers_do_not_reprobe_after_a_failure() {
    let cache = PathCache::new();
    cache.current(timed_out, inherited);
    let path = cache.current(
        || panic!("an ordinary reader must not run the shell again"),
        inherited,
    );
    assert_eq!(path, INHERITED);
}

/// The defect in #1628: Detect could never leave a fallback before a restart.
#[test]
fn refresh_recovers_from_a_failed_first_probe() {
    let cache = PathCache::new();
    cache.current(timed_out, inherited);

    cache.refresh(probed, inherited);

    assert_eq!(cache.current(timed_out, inherited), LOGIN);
    assert_eq!(cache.fallback(), None);
}

/// A PATH line added to the shell profile since launch reaches Detect too.
#[test]
fn refresh_replaces_a_successful_path() {
    let cache = PathCache::new();
    cache.current(|| Ok("/old".to_string()), inherited);

    cache.refresh(probed, inherited);

    assert_eq!(cache.current(timed_out, inherited), LOGIN);
}

#[test]
fn a_failed_refresh_keeps_a_good_path() {
    let cache = PathCache::new();
    cache.current(probed, inherited);

    cache.refresh(timed_out, inherited);

    assert_eq!(cache.current(timed_out, inherited), LOGIN);
    assert_eq!(cache.fallback(), None);
}

#[test]
fn a_failed_refresh_reports_the_latest_failure() {
    let cache = PathCache::new();
    cache.current(timed_out, inherited);

    cache.refresh(|| Err(failure(ProbeReason::Exit)), inherited);

    assert_eq!(cache.fallback().map(|f| f.reason), Some(ProbeReason::Exit));
}

#[test]
fn refresh_works_before_any_reader_has_probed() {
    let cache = PathCache::new();
    cache.refresh(probed, inherited);
    assert_eq!(cache.current(timed_out, inherited), LOGIN);
}

/// `OnceLock` guaranteed one probe under concurrent first readers; the mutexes
/// that replaced it have to as well, or startup spawns a shell per caller.
#[test]
fn concurrent_first_readers_share_one_probe() {
    let cache = PathCache::new();
    let probes = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                let path = cache.current(
                    || {
                        probes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(20));
                        probed()
                    },
                    inherited,
                );
                assert_eq!(path, LOGIN);
            });
        }
    });
    assert_eq!(probes.load(std::sync::atomic::Ordering::SeqCst), 1);
}

/// Codex audit of #1628: refreshes committing in completion order let an older
/// probe that finished late restore the PATH from before a profile edit.
#[test]
fn overlapping_refreshes_commit_in_the_order_they_started() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let cache = PathCache::new();
    let older_is_probing = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            cache.refresh(
                || {
                    older_is_probing.store(true, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    Ok("/older".to_string())
                },
                inherited,
            );
        });
        while !older_is_probing.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        cache.refresh(|| Ok("/newer".to_string()), inherited);
    });
    assert_eq!(cache.current(timed_out, inherited), "/newer");
}

/// Runs `first` until its probe has started, then `second`, so the two overlap.
fn overlap(first: impl FnOnce(&(dyn Fn() + Sync)) + Send, second: impl FnOnce()) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let probing = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            first(&|| {
                probing.store(true, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(200));
            })
        });
        while !probing.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        second();
    });
}

/// Codex audit of #1628: a first read committing while an older refresh was
/// still probing lost its answer to that refresh a moment later.
#[test]
fn a_first_read_during_a_refresh_waits_and_takes_its_answer() {
    let cache = PathCache::new();
    let mut read = String::new();
    overlap(
        |started| {
            cache.refresh(
                || {
                    started();
                    Ok("/refreshed".to_string())
                },
                inherited,
            )
        },
        || read = cache.current(|| panic!("the refresh is already probing"), inherited),
    );
    assert_eq!(read, "/refreshed");
    assert_eq!(cache.current(timed_out, inherited), "/refreshed");
}

#[test]
fn a_refresh_during_a_first_read_commits_after_it() {
    let cache = PathCache::new();
    overlap(
        |started| {
            cache.current(
                || {
                    started();
                    Ok("/first-read".to_string())
                },
                inherited,
            );
        },
        || cache.refresh(|| Ok("/refreshed".to_string()), inherited),
    );
    assert_eq!(cache.current(timed_out, inherited), "/refreshed");
}

/// Pandoc, the terminal and every AI call read this path, and a retry can take
/// the whole probe bound.
#[test]
fn a_reader_of_a_good_path_does_not_wait_for_a_refresh() {
    let cache = PathCache::new();
    cache.current(probed, inherited);
    cache.refresh(
        || {
            assert_eq!(cache.current(timed_out, inherited), LOGIN);
            Ok("/refreshed".to_string())
        },
        inherited,
    );
}

/// The notice's read must not wait on a shell that may take the whole bound.
#[test]
fn the_fallback_can_be_read_during_a_probe() {
    let cache = PathCache::new();
    cache.current(
        || {
            assert_eq!(cache.fallback(), None);
            probed()
        },
        inherited,
    );
}

#[test]
fn a_panicking_refresh_does_not_block_the_next_one() {
    let cache = PathCache::new();
    std::thread::scope(|scope| {
        let _ = scope
            .spawn(|| cache.refresh(|| panic!("the probe died"), inherited))
            .join();
    });
    cache.refresh(probed, inherited);
    assert_eq!(cache.current(timed_out, inherited), LOGIN);
}

#[test]
fn windows_reports_the_last_shells_reason() {
    assert_eq!(windows_reason(None), ProbeReason::NoPath);
    assert_eq!(
        windows_reason(Some(CaptureFailure::TooMuchOutput)),
        ProbeReason::NoPath
    );
    assert_eq!(
        windows_reason(Some(CaptureFailure::Spawn)),
        ProbeReason::Spawn
    );
    assert_eq!(
        windows_reason(Some(CaptureFailure::Exit)),
        ProbeReason::Exit
    );
    assert_eq!(
        windows_reason(Some(CaptureFailure::Timeout)),
        ProbeReason::Timeout
    );
}

#[test]
fn a_poisoned_cache_still_answers() {
    let cache = PathCache::new();
    cache.current(probed, inherited);
    std::thread::scope(|scope| {
        let _ = scope
            .spawn(|| {
                let _guard = cache.0.lock().unwrap();
                panic!("poison the cache");
            })
            .join();
    });
    assert_eq!(cache.current(timed_out, inherited), LOGIN);
}

/// The frontend switches on these strings to pick a translated reason.
#[test]
fn the_fallback_serializes_to_the_shape_the_settings_page_reads() {
    let reasons = [
        (ProbeReason::Spawn, "spawn"),
        (ProbeReason::Exit, "exit"),
        (ProbeReason::Timeout, "timeout"),
        (ProbeReason::NoPath, "noPath"),
    ];
    for (reason, name) in reasons {
        let value = serde_json::to_value(LoginPathFallback {
            shell: "zsh".to_string(),
            reason,
            path: INHERITED.to_string(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"shell": "zsh", "reason": name, "path": INHERITED})
        );
    }
}

#[test]
fn the_shell_label_is_its_file_name_only() {
    assert_eq!(shell_label("/bin/zsh"), "zsh");
    assert_eq!(shell_label("/opt/homebrew/bin/fish"), "fish");
    assert_eq!(shell_label("zsh"), "zsh");
    assert_eq!(shell_label(""), "");
}

#[test]
fn a_shell_that_cannot_start_is_a_spawn_failure() {
    let got = probe_unix_shell("/no/such/shell/vmark-xyz");
    assert_eq!(
        got,
        Err(ProbeFailure {
            shell: "vmark-xyz".to_string(),
            reason: ProbeReason::Spawn,
        })
    );
}

#[cfg(unix)]
mod through_a_fake_login_shell {
    use super::*;
    use crate::ai_provider::detection::tests::write_fake_shell;

    fn probe(body: &str) -> Result<String, ProbeFailure> {
        let dir = tempfile::tempdir().unwrap();
        let (shell, ran) = write_fake_shell(&dir, body);
        let got = probe_unix_shell(shell.to_str().unwrap());
        // Without this, a shell killed at the bound would pass the failure
        // cases below as if it had run and printed nothing useful.
        assert!(ran.exists(), "the fake shell never ran to completion");
        got
    }

    #[test]
    fn startup_noise_is_stripped_from_the_path() {
        let got = probe("motd\\n__VMARK_PATH_START__/a:/b__VMARK_PATH_END__\\nbye");
        assert_eq!(got.as_deref(), Ok("/a:/b"));
    }

    #[test]
    fn output_without_the_markers_is_not_a_path() {
        assert_eq!(
            probe("motd only").map_err(|f| f.reason),
            Err(ProbeReason::NoPath)
        );
    }

    /// #1628 from end to end, with a real process: the shell fails, gets fixed,
    /// and the next explicit refresh picks it up with no restart.
    #[test]
    fn a_shell_that_recovers_is_picked_up_by_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let (shell, ran) = write_fake_shell(&dir, "motd only");
        let shell = shell.to_str().unwrap().to_string();
        let cache = PathCache::new();

        assert_eq!(
            cache.current(|| probe_unix_shell(&shell), inherited),
            INHERITED
        );
        assert_eq!(
            cache.fallback().map(|f| f.shell),
            Some("fakezsh".to_string())
        );

        // The helper refuses a marker left by an earlier run.
        std::fs::remove_file(&ran).unwrap();
        write_fake_shell(&dir, "__VMARK_PATH_START__/fixed:/bin__VMARK_PATH_END__");
        cache.refresh(|| probe_unix_shell(&shell), inherited);

        assert_eq!(cache.current(timed_out, inherited), "/fixed:/bin");
        assert_eq!(cache.fallback(), None);
    }

    /// An empty PATH would find nothing, so it must not replace a good one.
    #[test]
    fn an_empty_path_counts_as_a_failure() {
        assert_eq!(
            probe("__VMARK_PATH_START____VMARK_PATH_END__").map_err(|f| f.reason),
            Err(ProbeReason::NoPath)
        );
    }
}
