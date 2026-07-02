//! Atomic bundle swap + recovery (Phase 1, WI-1.1; grill H9/L3).
//!
//! Split out of `provision.rs` to keep both modules under the file-size limit.
//! Provides the staging→target swap (with cross-device fallback), startup
//! reconciliation after an interrupted swap, and a streaming file checksum.

use super::provision::{hex_encode, BundleKind};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Plan for atomically swapping a freshly-extracted staging dir into place.
/// Keeping this pure makes the ordering (which guarantees no half-installed
/// tree is ever `Ready`) testable without touching the filesystem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwapPlan {
    /// Where extraction wrote the new tree.
    pub staging: PathBuf,
    /// Final location the server reads from.
    pub target: PathBuf,
    /// Where an existing target is moved before the swap (then deleted).
    pub backup: PathBuf,
}

/// Compute the staging/target/backup paths for a bundle under `root`.
pub fn plan_swap(root: &Path, kind: BundleKind) -> SwapPlan {
    let dir = kind.dir_name();
    SwapPlan {
        staging: root.join(format!("{dir}.staging")),
        target: root.join(dir),
        backup: root.join(format!("{dir}.backup")),
    }
}

/// Move `staging` onto `target`, falling back to copy+remove across
/// filesystems (EXDEV — grill H9; `std::fs::rename` is only intra-FS atomic).
fn move_dir(staging: &Path, target: &Path) -> std::io::Result<()> {
    match std::fs::rename(staging, target) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(EXDEV) => {
            copy_dir_all(staging, target)?;
            std::fs::remove_dir_all(staging)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// EXDEV errno (18 on Linux/macOS). Kept local to avoid a libc dependency.
const EXDEV: i32 = 18;

/// Recursively copy a directory tree (used for the cross-device swap fallback).
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Execute the swap: backup existing target, move staging→target, drop backup.
/// On failure the original target is restored AND the staging tree is cleaned
/// up (grill H9 — no orphaned 451 MB `.staging` accumulating on disk).
pub fn execute_swap(plan: &SwapPlan) -> std::io::Result<PathBuf> {
    let _ = std::fs::remove_dir_all(&plan.backup);
    if plan.target.exists() {
        std::fs::rename(&plan.target, &plan.backup)?;
    }
    match move_dir(&plan.staging, &plan.target) {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&plan.backup);
            Ok(plan.target.clone())
        }
        Err(e) => {
            // Restore the backup so we never leave a missing target...
            if plan.backup.exists() {
                let _ = std::fs::rename(&plan.backup, &plan.target);
            }
            // ...and remove the half-installed staging tree.
            let _ = std::fs::remove_dir_all(&plan.staging);
            Err(e)
        }
    }
}

/// Startup reconciliation (grill H9 — "interrupted-extraction recovery"). If a
/// crash happened mid-swap leaving no `target` but a `backup` (the old good
/// tree), promote the backup back. Also clears any stale `staging`. Idempotent.
pub fn reconcile(plan: &SwapPlan) -> std::io::Result<()> {
    if !plan.target.exists() && plan.backup.exists() {
        std::fs::rename(&plan.backup, &plan.target)?;
    }
    let _ = std::fs::remove_dir_all(&plan.staging);
    let _ = std::fs::remove_dir_all(&plan.backup);
    Ok(())
}

/// Streaming checksum over a file on disk (grill L3 — avoids holding a 451 MB
/// tarball in memory; the in-memory `verify_checksum` remains for small inputs).
pub fn verify_file_checksum(path: &Path, expected_hex: &str) -> std::io::Result<bool> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual = hex_encode(&hasher.finalize());
    Ok(actual.eq_ignore_ascii_case(expected_hex.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_swap_derives_sibling_paths() {
        let plan = plan_swap(Path::new("/data"), BundleKind::Slidev);
        assert_eq!(plan.target, Path::new("/data/slidev"));
        assert_eq!(plan.staging, Path::new("/data/slidev.staging"));
        assert_eq!(plan.backup, Path::new("/data/slidev.backup"));
    }

    #[test]
    fn execute_swap_replaces_existing_atomically() {
        let tmp = tempfile::tempdir().unwrap();
        let plan = plan_swap(tmp.path(), BundleKind::BaseKb);
        std::fs::create_dir_all(&plan.target).unwrap();
        std::fs::write(plan.target.join("v.txt"), "old").unwrap();
        std::fs::create_dir_all(&plan.staging).unwrap();
        std::fs::write(plan.staging.join("v.txt"), "new").unwrap();
        let out = execute_swap(&plan).unwrap();
        assert_eq!(out, plan.target);
        assert_eq!(
            std::fs::read_to_string(plan.target.join("v.txt")).unwrap(),
            "new"
        );
        assert!(!plan.staging.exists());
        assert!(!plan.backup.exists());
    }

    #[test]
    fn execute_swap_into_empty_target() {
        let tmp = tempfile::tempdir().unwrap();
        let plan = plan_swap(tmp.path(), BundleKind::BaseKb);
        std::fs::create_dir_all(&plan.staging).unwrap();
        std::fs::write(plan.staging.join("x"), "1").unwrap();
        let out = execute_swap(&plan).unwrap();
        assert!(out.join("x").exists());
    }

    #[test]
    fn execute_swap_failure_restores_target_and_cleans_staging() {
        // grill H9 — no staging → swap fails; original target survives, no orphan.
        let tmp = tempfile::tempdir().unwrap();
        let plan = plan_swap(tmp.path(), BundleKind::BaseKb);
        std::fs::create_dir_all(&plan.target).unwrap();
        std::fs::write(plan.target.join("v.txt"), "old").unwrap();
        assert!(execute_swap(&plan).is_err());
        assert_eq!(
            std::fs::read_to_string(plan.target.join("v.txt")).unwrap(),
            "old"
        );
        assert!(!plan.backup.exists());
        assert!(!plan.staging.exists());
    }

    #[test]
    fn reconcile_promotes_backup_when_target_missing() {
        // grill H9 — crash mid-swap: target gone, backup holds last good tree.
        let tmp = tempfile::tempdir().unwrap();
        let plan = plan_swap(tmp.path(), BundleKind::Slidev);
        std::fs::create_dir_all(&plan.backup).unwrap();
        std::fs::write(plan.backup.join("good.txt"), "good").unwrap();
        std::fs::create_dir_all(&plan.staging).unwrap();
        std::fs::write(plan.staging.join("partial.txt"), "half").unwrap();
        reconcile(&plan).unwrap();
        assert!(plan.target.exists());
        assert_eq!(
            std::fs::read_to_string(plan.target.join("good.txt")).unwrap(),
            "good"
        );
        assert!(!plan.staging.exists());
        assert!(!plan.backup.exists());
    }

    #[test]
    fn reconcile_is_noop_when_target_present() {
        let tmp = tempfile::tempdir().unwrap();
        let plan = plan_swap(tmp.path(), BundleKind::BaseKb);
        std::fs::create_dir_all(&plan.target).unwrap();
        std::fs::write(plan.target.join("keep.txt"), "keep").unwrap();
        reconcile(&plan).unwrap();
        assert_eq!(
            std::fs::read_to_string(plan.target.join("keep.txt")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn verify_file_checksum_streams_from_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("blob.bin");
        std::fs::write(&p, b"hello").unwrap();
        assert!(verify_file_checksum(
            &p,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        )
        .unwrap());
        assert!(!verify_file_checksum(&p, "deadbeef").unwrap());
    }
}
