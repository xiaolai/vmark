//! Second-launch argv: what a second `vmark` process is asking to open.
//!
//! Purpose: turn the raw argv the single-instance plugin forwards into paths
//! that mean what the user typed — relative arguments resolved against the
//! SECOND launch's working directory, and the program path dropped before the
//! supported-file gate. Pure functions over strings and the filesystem, kept
//! apart from the window decisions in `single_instance.rs`.
//!
//! @coordinates-with single_instance.rs — `second_launch_with`, the only caller
//! @coordinates-with supported_files.rs — `filter_supported_args`, the gate

use crate::supported_files;

/// `argv` with every relative argument after `argv[0]` made absolute against
/// `cwd`, the second launch's own working directory.
///
/// Every later check (`Path::is_dir`, `is_file`, `canonical_dir`) resolves a
/// relative path against THIS process's cwd, which is where the running VMark
/// was started, not where the user typed `vmark .`. A folder argument then
/// names a directory that always exists and opens — and grants — the wrong
/// workspace. When `cwd` is empty or itself relative there is no way to know
/// what a relative argument meant, so it is dropped rather than guessed.
pub(crate) fn resolve_against_launch_cwd(argv: Vec<String>, cwd: &str) -> Vec<String> {
    let base = std::path::Path::new(cwd);
    let base = base.is_absolute().then_some(base);
    let mut args = argv.into_iter();
    args.next()
        .into_iter()
        .chain(args.filter_map(|arg| {
            if std::path::Path::new(&arg).is_absolute() {
                Some(arg)
            } else {
                base.map(|b| b.join(&arg).to_string_lossy().into_owned())
            }
        }))
        .collect()
}

/// The openable files a second launch is asking for.
///
/// `argv[0]` is dropped before the gate, not after: it is the program path,
/// and a build whose own name ends in a registered extension would otherwise
/// open the executable as a document.
pub(crate) fn openable_files_from_argv(argv: Vec<String>) -> Vec<String> {
    supported_files::filter_supported_args(argv.into_iter().skip(1))
}
