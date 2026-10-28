//! Feeding a `git` child its stdin from a writer thread while its output is
//! collected, so a large stdin cannot deadlock against a full stdout pipe.
//!
//! Without a thread nothing feeds Git: the child is stopped and reaped
//! rather than left to read a truncated stdin, and the failure keeps the
//! export's stable `ExportError::Git` shape instead of panicking the task.
//!
//! @module agent_journal/git_export/stdin_feed

use std::io::{self, Write};
use std::process::{Child, ChildStdin, Output};
use std::thread::{Builder, JoinHandle};

use super::error::ExportError;

/// The writer's work, handed to the thread starter.
pub(super) type Feed = Box<dyn FnOnce() -> io::Result<()> + Send>;

/// Starts the writer thread; `Builder::spawn` in production.
pub(super) type StartThread = fn(Builder, Feed) -> io::Result<JoinHandle<io::Result<()>>>;

/// The production thread starter.
pub(super) fn start_thread(builder: Builder, feed: Feed) -> io::Result<JoinHandle<io::Result<()>>> {
    builder.spawn(feed)
}

/// Write `bytes` to `pipe` on a thread started by `start` and wait for
/// `child`. A refused Git may close stdin unread: then its own exit status
/// (judged by the caller) is the cause, and the broken pipe is ignored.
pub(super) fn fed_output(
    mut child: Child,
    mut pipe: ChildStdin,
    bytes: Vec<u8>,
    start: StartThread,
) -> Result<Output, ExportError> {
    let feeder = match start(
        Builder::new().name("git-stdin".to_owned()),
        Box::new(move || pipe.write_all(&bytes)),
    ) {
        Ok(feeder) => feeder,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ExportError::Git(format!(
                "cannot start the stdin writer: {e}"
            )));
        }
    };
    let out = waited(child.wait_with_output())?;
    let fed = feeder.join();
    if out.status.success() {
        fed.map_err(|_| ExportError::Git("stdin writer panicked".to_owned()))?
            .map_err(|e| ExportError::Git(format!("writing to git failed: {e}")))?;
    }
    Ok(out)
}

/// Collecting the child's output failed.
pub(super) fn waited(out: io::Result<Output>) -> Result<Output, ExportError> {
    out.map_err(|e| ExportError::Git(format!("git did not finish: {e}")))
}

#[cfg(test)]
#[path = "stdin_feed.test.rs"]
mod tests;
