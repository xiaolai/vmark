//! Path validation for the `open_workspace` MCP tool.
//!
//! Opening a folder as a workspace GRANTS the AI a new file tree, so — unlike a
//! file inside an already-consented root — it can't use the bridge path guard
//! (Codex F-11) and is gated by user approval instead. This validates the
//! target in Rust (not a webview `stat`), keeping raw fs out of the MCP bridge
//! surface, and canonicalizes so the granted tree and the approval one-shot
//! bind to the REAL target rather than a symlink name (Codex F-06). The
//! canonical path is spelled for the frontend by `canonical_path` — the
//! UTF-8 refusal and the Windows verbatim strip live there, shared with the
//! window-open commands (#250).

use crate::canonical_path::canonical_string;
use crate::command_error::{CommandError, ErrorCode};

/// Canonicalize `path` (resolving symlinks) and require it be a directory,
/// returning the canonical path for the approval one-shot binding.
///
/// **Typed, and `async`** (audit 20260907 #560, #561).
///
/// Typed because the caller has to tell a folder that is GONE from one that is
/// a file from one it may not read: `open_workspace` is an approval flow, and
/// "invalid workspace folder" as prose is what `CommandError` exists to end
/// (rule 50 §10).
///
/// `async` for the reason `secure_store` records at its own `off_ipc_thread`
/// (audit #470): a non-`async` `#[tauri::command]` is
/// `ExecutionContext::Blocking`, so Tauri runs its body inline on the thread
/// that delivered the IPC message — and `canonicalize` is an unbounded
/// filesystem call. On a disconnected SMB share or a stale automount it blocks
/// for the mount's own timeout, and it takes the IPC channel down with it. The
/// whole check goes to `spawn_blocking`, `is_dir` included, so nothing on that
/// thread touches a disk.
///
/// Going async removes the serialization the blocking IPC loop provided (rule
/// 50 §10), so: this command reads and writes NO shared state. The
/// canonicalize-then-`is_dir` pair is a check-then-act, but it is one this
/// command has always had and cannot close — the whole point of returning the
/// canonical path is that the CALLER binds to the resolved target rather than
/// to the name, which is what makes a later swap detectable.
#[tauri::command]
pub async fn validate_workspace_dir(path: String) -> Result<String, CommandError> {
    tokio::task::spawn_blocking(move || validate_workspace_dir_at(&path))
        .await
        .map_err(|e| CommandError::internal(format!("workspace validation task failed: {e}")))?
}

/// The synchronous body, so the classification is testable without a runtime.
fn validate_workspace_dir_at(path: &str) -> Result<String, CommandError> {
    let canonical = std::path::Path::new(path).canonicalize().map_err(|e| {
        // The KIND carries the distinction the caller needs — a folder that was
        // deleted, one it may not traverse, and a genuine I/O failure are three
        // different things to tell a user, and they were one string before.
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::Io,
        };
        CommandError::new(code, format!("invalid workspace folder '{path}': {e}"))
    })?;
    if !canonical.is_dir() {
        return Err(CommandError::invalid_input(format!(
            "'{path}' is not a directory"
        )));
    }
    canonical_string(&canonical, &format!("workspace folder '{path}'"))
        .map_err(CommandError::invalid_input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_nonexistent_path() {
        assert!(validate_workspace_dir_at("/no/such/dir/xyzzy").is_err());
    }

    /// The whole point of canonicalizing (Codex F-06): the value that travels
    /// on — the tree the AI is granted, and what the approval one-shot binds
    /// to — must name the REAL directory, not the link the caller typed.
    ///
    /// `is_ok()` alone would pass a version of this function that returned its
    /// input unchanged, which is exactly the defect the canonicalization
    /// exists to prevent.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_resolves_to_its_target_not_to_the_link_name() {
        let root = tempfile::tempdir().expect("tempdir");
        let real = root.path().join("real-workspace");
        std::fs::create_dir(&real).expect("mkdir");
        let link = root.path().join("link-to-workspace");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");

        let got = validate_workspace_dir_at(link.to_str().expect("utf-8")).expect("a directory");
        let want = real.canonicalize().expect("canonical target");
        assert_eq!(
            got,
            want.to_str().expect("utf-8"),
            "the canonical TARGET must travel on, not the link name"
        );
        assert_ne!(
            got,
            link.to_string_lossy(),
            "returning the alias would let a re-pointed link redirect the grant"
        );
    }

    /// An ISOLATED directory, not `$TMPDIR` with a fixed name (#563). The old
    /// fixture wrote `$TMPDIR/vmark-ws-validate-test.txt` — a path any other
    /// process may already own — overwrote whatever was there, and deleted it
    /// on the way out; two runs of this suite at once raced each other for it.
    /// #560 — the three refusals carry three CODES, not one prose string.
    ///
    /// `open_workspace` is an approval flow: a folder that was deleted, a path
    /// that is a file, and one this process may not traverse call for three
    /// different things from the caller, and `errorMessage`-matching on a
    /// single string could tell them apart only by wording.
    #[test]
    fn each_refusal_carries_the_code_that_distinguishes_it() {
        let dir = tempfile::tempdir().expect("tempdir");

        let missing = validate_workspace_dir_at("/no/such/dir/xyzzy").expect_err("absent");
        assert_eq!(missing.code(), ErrorCode::NotFound);

        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"x").expect("write");
        // A file canonicalizes fine, so this reaches the is-dir refusal rather
        // than the canonicalize one — the branch that used to share a message
        // with a missing path.
        let not_a_dir =
            validate_workspace_dir_at(file.to_string_lossy().as_ref()).expect_err("a file");
        assert_eq!(not_a_dir.code(), ErrorCode::InvalidInput);
    }

    #[test]
    fn rejects_a_file_and_accepts_a_directory() {
        let dir = tempfile::tempdir().expect("tempdir");

        // A real directory: its canonical form is returned.
        let ok = validate_workspace_dir_at(dir.path().to_string_lossy().as_ref());
        assert!(ok.is_ok());

        // A file inside it is rejected.
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"x").expect("write");
        assert!(validate_workspace_dir_at(file.to_string_lossy().as_ref()).is_err());
    }
}
