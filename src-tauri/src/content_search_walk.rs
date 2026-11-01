//! # Content Search — Directory Walk
//!
//! Purpose: the traversal half of workspace content search — which
//! directories are entered, which entries are files worth scanning, in what
//! order, and when the search stops.
//!
//! Key decisions:
//!   - One `DirEntry::file_type()` classifies an entry. It is the type the
//!     directory listing already carries on most filesystems (no `stat`), and
//!     it does not follow links, so "never follow a symlink out of the
//!     workspace" needs no second lookup.
//!   - Depth-first over an explicit stack. Sibling directories are sorted by
//!     path and visited from the last one; files are scanned in the order the
//!     OS lists them.
//!   - `DeadlineBudget` is the one place the search reads the clock, and the
//!     one definition of the strided check the inner loops use.
//!   - `Tally::complete` goes false whenever eligible content went unseen:
//!     a cap, a spent budget, an unreadable directory, an unscanned file.
//!
//! @coordinates-with content_search.rs — builds the plan and returns the tally
//! @coordinates-with content_search_file.rs — scans each listed file
//! @module content_search_walk

use super::file_scan::{scan_file, FileScan};
use super::matching::{matches_extensions, should_skip_dir, LineMatch};
use super::{FileSearchResult, MAX_FILES, MAX_MATCHES};
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Inner loops look at the clock once per this many steps — often enough to
/// keep the wall-clock cap responsive on a huge directory or a very long
/// file, without an `Instant::now()` on every iteration.
const DEADLINE_CHECK_STRIDE: usize = 256;

/// The wall-clock budget of one search.
#[derive(Clone, Copy)]
pub(super) struct DeadlineBudget {
    deadline: Instant,
}

impl DeadlineBudget {
    pub(super) fn until(deadline: Instant) -> Self {
        Self { deadline }
    }

    /// True once the budget is spent. Reads the clock.
    pub(super) fn spent(&self) -> bool {
        Instant::now() >= self.deadline
    }

    /// `spent`, for step `step` of an inner loop: the clock is only read on
    /// every `DEADLINE_CHECK_STRIDE`-th step, starting with the first.
    pub(super) fn spent_at_step(&self, step: usize) -> bool {
        step.is_multiple_of(DEADLINE_CHECK_STRIDE) && self.spent()
    }
}

/// What one search looks for and where.
pub(super) struct SearchPlan<'a> {
    pub re: &'a Regex,
    pub root: &'a Path,
    pub markdown_only: bool,
    pub extensions: &'a [String],
    pub exclude_folders: &'a [String],
    pub budget: DeadlineBudget,
}

/// What the search has found so far, and whether it has seen everything.
pub(super) struct Tally {
    pub results: Vec<FileSearchResult>,
    pub total_matches: usize,
    pub complete: bool,
}

impl Tally {
    fn at_cap(&self) -> bool {
        self.results.len() >= MAX_FILES || self.total_matches >= MAX_MATCHES
    }
}

/// One directory's entries, sorted into what the walk does next.
struct DirLevel {
    /// Directories to descend into, sorted by path.
    subdirs: Vec<PathBuf>,
    /// Files to scan, in the OS's enumeration order.
    files: Vec<PathBuf>,
    /// False when the budget ran out before every entry was listed.
    fully_listed: bool,
}

/// List one directory level. `None` when the directory cannot be read.
fn list_dir_level(dir: &Path, plan: &SearchPlan) -> Option<DirLevel> {
    let entries = fs::read_dir(dir).ok()?;
    let mut level = DirLevel {
        subdirs: Vec::new(),
        files: Vec::new(),
        fully_listed: true,
    };

    for (i, entry) in entries.flatten().enumerate() {
        if plan.budget.spent_at_step(i) {
            level.fully_listed = false; // remaining entries were never enumerated
            break;
        }
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        // Skip symlinks to prevent directory traversal outside workspace
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if !should_skip_dir(name, plan.exclude_folders) {
                level.subdirs.push(entry.path());
            }
        } else if file_type.is_file() {
            // Skip hidden files
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if plan.markdown_only && !matches_extensions(&path, plan.extensions) {
                continue;
            }
            level.files.push(path);
        }
    }

    // Sort subdirs for deterministic ordering
    level.subdirs.sort();
    Some(level)
}

/// The result entry for a file with matches: its absolute path, and its path
/// relative to the searched root with `/` separators.
fn result_for(file_path: &Path, root: &Path, matches: Vec<LineMatch>) -> FileSearchResult {
    let relative = file_path
        .strip_prefix(root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");

    FileSearchResult {
        path: file_path.to_string_lossy().to_string(),
        relative_path: relative,
        matches,
    }
}

/// Walk the tree under `plan.root` and scan every eligible file.
pub(super) fn walk(plan: &SearchPlan) -> Tally {
    let mut tally = Tally {
        results: Vec::new(),
        total_matches: 0,
        complete: true,
    };
    let mut dirs_to_visit: Vec<PathBuf> = vec![plan.root.to_path_buf()];

    while let Some(dir) = dirs_to_visit.pop() {
        if tally.at_cap() || plan.budget.spent() {
            tally.complete = false; // directories remain unvisited
            break;
        }

        let Some(level) = list_dir_level(&dir, plan) else {
            tally.complete = false; // this directory's files were never seen
            continue;
        };
        if !level.fully_listed {
            tally.complete = false;
        }
        dirs_to_visit.extend(level.subdirs);

        for file_path in level.files {
            if tally.at_cap() || plan.budget.spent() {
                tally.complete = false; // remaining files were never scanned
                break;
            }

            match scan_file(&file_path, plan.re, &plan.budget, &mut tally.total_matches) {
                FileScan::Excluded => {}
                FileScan::Unscanned => tally.complete = false,
                FileScan::OutOfTime => {
                    tally.complete = false;
                    break;
                }
                FileScan::Scanned { matches, finished } => {
                    if !finished {
                        tally.complete = false;
                    }
                    if !matches.is_empty() {
                        tally
                            .results
                            .push(result_for(&file_path, plan.root, matches));
                    }
                }
            }
        }
    }

    tally
}

#[cfg(test)]
#[path = "content_search_walk.test.rs"]
mod tests;
