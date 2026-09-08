//! One canonical path, spelled the way the frontend can use it (#250).
//!
//! `Path::canonicalize` is how this crate turns a name the webview supplied
//! into the target it actually judged. Handing that target onward — rather
//! than the name — is what stops a symlink swapped after the check from
//! redirecting every later step. Two things have to happen first, and both
//! were already being done, separately, in `workspace_validation.rs`:
//!
//!   - **UTF-8, or refuse.** `to_string_lossy` would replace bytes with
//!     U+FFFD, so the frontend would open — and an approval one-shot would
//!     bind to — a DIFFERENT path than the one validated (Codex M1).
//!   - **Strip the Windows extended-length prefix.** `canonicalize` yields
//!     `\\?\C:\repo` there, and the frontend's absolute-path and containment
//!     checks do not recognise it, so an approved root fails its own follow-up
//!     operations. Stripping is textual and resolves nothing: every component
//!     was already resolved, so it names the same file.
//!
//! Always compiled (the strip is a no-op on Unix, whose paths never carry the
//! prefix) so it can be unit-tested on any platform.
//!
//! @coordinates-with window_manager/path_validation.rs — the window commands
//! @coordinates-with workspace_validation.rs — the `open_workspace` MCP tool
//! @module canonical_path

use std::path::Path;

/// Strip a Windows extended-length (`\\?\` / `\\?\UNC\`) prefix from a
/// canonical path string, returning `None` when there is nothing to strip.
///
/// Only the two spellings that mean the SAME file under ordinary Win32
/// normalization are stripped, and only when every component survives it:
///
///   - `\\?\C:\…` — a drive-letter path, and
///   - `\\?\UNC\server\share\…` — a UNC path.
///
/// Everything else keeps its prefix. That is not caution for its own sake:
/// `\\?\` turns OFF normalization, so a name whose component ends in a dot or
/// a space (`\\?\C:\dir\report.`) is a DIFFERENT file from the one Win32
/// resolves after stripping — Win32 trims both — and a volume-GUID path
/// (`\\?\Volume{…}\file`) is not a drive path at all: stripping it yields
/// `Volume{…}\file`, a RELATIVE name resolved against the process CWD. In
/// each case the stripped string names something other than the object that
/// was canonicalized, which is the one thing this function exists to prevent.
/// Keeping the verbatim spelling may fail a frontend check; naming a
/// different file silently succeeds against the wrong one.
pub(crate) fn strip_verbatim_prefix(s: &str) -> Option<String> {
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        let rest = s.strip_prefix(r"\\?\")?;
        if !is_drive_rooted(rest) {
            return None;
        }
        rest.to_owned()
    };
    normalization_safe(&stripped).then_some(stripped)
}

/// `C:\…` — a single ASCII drive letter, a colon, then a separator.
fn is_drive_rooted(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.next() == Some(':')
        && matches!(chars.next(), Some('\\') | Some('/'))
}

/// Would Win32 normalization leave every component of `s` alone?
///
/// It trims trailing dots and spaces from each component, so a name carrying
/// either means something else once the verbatim prefix is gone.
fn normalization_safe(s: &str) -> bool {
    s.split(['\\', '/'])
        .all(|part| part == "." || part == ".." || (!part.ends_with('.') && !part.ends_with(' ')))
}

/// A canonical path as the string that travels on: UTF-8-checked and free of
/// the Windows verbatim prefix. `label` names the thing being validated, for
/// the refusal message.
pub(crate) fn canonical_string(canonical: &Path, label: &str) -> Result<String, String> {
    let text = canonical
        .to_str()
        .ok_or_else(|| format!("{label} has a non-UTF-8 path"))?;
    Ok(strip_verbatim_prefix(text).unwrap_or_else(|| text.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_prefix_on_paths_that_would_not_survive_win32_normalization() {
        // A volume-GUID path is not drive-rooted: stripping it would yield the
        // RELATIVE name `Volume{...}\note.md`.
        assert_eq!(
            strip_verbatim_prefix(r"\\?\Volume{1a2b3c4d-0000-0000-0000-000000000000}\note.md"),
            None
        );
        // Win32 trims a trailing dot or space from every component, so the
        // stripped spelling names a different file than the one canonicalized.
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\dir\report."), None);
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\dir \report.md"), None);
        // And the value that travels on keeps the prefix rather than naming
        // something else.
        assert_eq!(
            canonical_string(Path::new(r"\\?\C:\dir\report."), "the file").as_deref(),
            Ok(r"\\?\C:\dir\report.")
        );
    }

    #[test]
    fn relative_dot_components_are_not_mistaken_for_a_trailing_dot() {
        // `.` and `..` end in a dot but are not names Win32 trims.
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\a\..\b").as_deref(),
            Some(r"C:\a\..\b")
        );
    }

    #[test]
    fn strips_windows_verbatim_prefixes() {
        // A drive path and a UNC path lose their extended-length prefix; a
        // normal path is left untouched (None ⇒ caller keeps the original).
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\repo").as_deref(),
            Some(r"C:\repo")
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share").as_deref(),
            Some(r"\\server\share"),
        );
        assert_eq!(strip_verbatim_prefix(r"C:\repo"), None);
        assert_eq!(strip_verbatim_prefix("/Users/x/proj"), None);
    }

    #[test]
    fn canonical_string_passes_a_plain_path_through() {
        assert_eq!(
            canonical_string(Path::new("/Users/x/proj/note.md"), "the file").as_deref(),
            Ok("/Users/x/proj/note.md")
        );
    }

    #[test]
    fn canonical_string_strips_the_verbatim_prefix() {
        assert_eq!(
            canonical_string(Path::new(r"\\?\C:\repo\note.md"), "the file").as_deref(),
            Ok(r"C:\repo\note.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn canonical_string_refuses_a_non_utf8_path_rather_than_mangling_it() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let raw = OsStr::from_bytes(b"/tmp/\xff\xfe/note.md");
        let err = canonical_string(Path::new(raw), "the workspace folder")
            .expect_err("lossy conversion would name a different file");
        assert!(err.contains("non-UTF-8"), "got: {err}");
        assert!(err.contains("the workspace folder"), "got: {err}");
    }
}
