//! Background-task helpers.
//!
//! `tokio::spawn`-ed tasks that panic are silently lost: the runtime swallows
//! the unwind and continues. `std::thread::spawn`-ed threads do log a panic
//! by default, but the message is unstructured and easy to miss in busy
//! output. Long-running orchestration work (cancel bridges, channel pumps,
//! workflow runners, shutdown coordinators, autosave loops) needs a louder
//! failure mode — a missing cancel bridge causes orphaned tokens, a missing
//! shutdown hook leaves the app unable to quit cleanly. These helpers catch
//! the panic, log a structured error, and let the runtime collect the
//! JoinHandle / thread handle normally.
//!
//! The helpers don't restart the task. Restart policy is task-specific and
//! belongs in the caller; this module's job is only to make panics visible.
//!
//! @module task

use futures_util::FutureExt;
use std::any::Any;
use std::future::Future;
use std::panic::AssertUnwindSafe;

/// Spawn a future and log a structured error if it panics.
///
/// The `name` is included in the log message so the operator can identify
/// which background subsystem failed. Tasks that complete normally produce
/// no log output.
pub fn spawn_logged<F>(name: &'static str, fut: F) -> tokio::task::JoinHandle<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        if let Err(payload) = AssertUnwindSafe(fut).catch_unwind().await {
            log::error!(
                "[task:{}] background task panicked: {}",
                name,
                panic_payload_message(&payload)
            );
        }
    })
}

/// Spawn an OS thread and log a structured error if it panics.
///
/// Unlike `tokio::spawn`, an OS thread's default panic handler already prints
/// to stderr, but the message is unstructured and lacks the subsystem name.
/// This wrapper produces the same "[task:<name>] background task panicked"
/// format as `spawn_logged` so log filters work uniformly across both.
pub fn spawn_thread_logged<F>(name: &'static str, f: F) -> std::thread::JoinHandle<()>
where
    F: FnOnce() + Send + 'static,
{
    std::thread::Builder::new()
        .name(format!("vmark-{}", name))
        .spawn(move || {
            if let Err(payload) = std::panic::catch_unwind(AssertUnwindSafe(f)) {
                log::error!(
                    "[task:{}] background thread panicked: {}",
                    name,
                    panic_payload_message(&payload)
                );
            }
        })
        .expect("OS must be able to spawn a thread for background work")
}

/// Extract a printable message from an `Any` payload returned by
/// `catch_unwind`. Handles the two common payload types (`&'static str` and
/// `String`) directly; falls back to a generic description for anything else.
///
/// Exposed `pub(crate)` so call sites that wrap their own `catch_unwind`
/// (because they need to preserve a non-tokio JoinHandle type or a thread
/// name) can produce identically-formatted diagnostic strings without
/// reimplementing the downcast chain.
pub(crate) fn panic_payload_message(payload: &Box<dyn Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    "non-string panic payload".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawn_logged_passes_through_normal_completion() {
        let handle = spawn_logged("test-normal", async {});
        handle.await.expect("normal task must complete without runtime error");
    }

    #[tokio::test]
    async fn spawn_logged_catches_str_panic() {
        // catch_unwind should absorb the panic; the JoinHandle must resolve
        // Ok(()) rather than JoinError::is_panic().
        let handle = spawn_logged("test-str-panic", async {
            panic!("simulated &'static str panic");
        });
        let result = handle.await;
        assert!(
            result.is_ok(),
            "spawn_logged must absorb panics; join returned: {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn spawn_logged_catches_string_panic() {
        let handle = spawn_logged("test-string-panic", async {
            panic!("{}", String::from("simulated String panic"));
        });
        let result = handle.await;
        assert!(
            result.is_ok(),
            "spawn_logged must absorb String panics; join returned: {:?}",
            result.err()
        );
    }

    #[test]
    fn payload_message_handles_static_str() {
        let payload: Box<dyn Any + Send> = Box::new("static-str");
        assert_eq!(panic_payload_message(&payload), "static-str");
    }

    #[test]
    fn payload_message_handles_string() {
        let payload: Box<dyn Any + Send> = Box::new(String::from("owned-string"));
        assert_eq!(panic_payload_message(&payload), "owned-string");
    }

    #[test]
    fn payload_message_falls_back_for_unknown_type() {
        let payload: Box<dyn Any + Send> = Box::new(42_i32);
        assert_eq!(panic_payload_message(&payload), "non-string panic payload");
    }

    #[test]
    fn spawn_thread_logged_passes_through_normal_completion() {
        let handle = spawn_thread_logged("test-thread-normal", || {});
        handle.join().expect("normal thread must join without runtime error");
    }

    #[test]
    fn spawn_thread_logged_catches_panic_and_joins_ok() {
        // The thread panics, but catch_unwind absorbs it and the join handle
        // resolves Ok rather than Err.
        let handle = spawn_thread_logged("test-thread-panic", || {
            panic!("simulated thread panic");
        });
        let result = handle.join();
        assert!(
            result.is_ok(),
            "spawn_thread_logged must absorb panics; join returned: {:?}",
            result.err()
        );
    }
}
