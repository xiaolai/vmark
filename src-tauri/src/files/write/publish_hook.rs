//! Test seam for the held-folder save: run a hook once at a named point of
//! a write — just before the folder is opened and held, or just before the
//! rename that publishes a name — where a swapped folder, a racing creator
//! or a second writer must be shown to lose. Keyed by entry name, so a test
//! gives its file a name no other test uses. Compiled only for tests.
//!
//! @coordinates-with files/write/anchored.rs — calls `run` before its rename
//! @coordinates-with files/write.rs — calls `run_before_hold` before opening the folder
//! @module files/write/publish_hook

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::sync::Mutex;

/// Where in a write a hook runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Point {
    Hold,
    Publish,
}

type Hook = Box<dyn FnOnce() + Send>;
// A static, not app state: the seam sits inside the write core, which no
// `AppHandle` reaches, and it exists only in test builds.
static HOOKS: Mutex<Option<HashMap<(Point, OsString), Hook>>> = Mutex::new(None);

fn register(point: Point, name: &str, hook: Hook) {
    let mut hooks = HOOKS.lock().unwrap_or_else(|e| e.into_inner());
    hooks
        .get_or_insert_with(HashMap::new)
        .insert((point, name.into()), hook);
}

fn take_and_run(point: Point, name: &OsStr) {
    let hook = {
        let mut hooks = HOOKS.lock().unwrap_or_else(|e| e.into_inner());
        hooks
            .as_mut()
            .and_then(|h| h.remove(&(point, name.to_os_string())))
    };
    if let Some(hook) = hook {
        hook();
    }
}

/// Run `hook` the next time a write publishes an entry called `name`.
pub(crate) fn before_publish(name: &str, hook: impl FnOnce() + Send + 'static) {
    register(Point::Publish, name, Box::new(hook));
}

/// Run `hook` the next time a write of an entry called `name` is about to
/// open and hold its folder (after the path was resolved).
pub(crate) fn before_hold(name: &str, hook: impl FnOnce() + Send + 'static) {
    register(Point::Hold, name, Box::new(hook));
}

/// Run (and forget) the publish hook registered for `name`, if any.
pub(crate) fn run(name: &OsStr) {
    take_and_run(Point::Publish, name);
}

/// Run (and forget) the hold hook registered for `name`, if any.
pub(crate) fn run_before_hold(name: &OsStr) {
    take_and_run(Point::Hold, name);
}
