//! # File Ops
//!
//! Purpose: Lightweight metadata commands used by the frontend before it commits
//! to reading a file into a tab. Currently exposes `get_file_size_bytes`, the
//! size-check step of the large-file open flow.
//!
//! Pipeline: Frontend invoke("get_file_size_bytes") → fs::metadata → len in bytes.
//!
//! Key decisions:
//!   - Symbolic links are followed (`fs::metadata` default) so the reported size
//!     matches what a subsequent `readTextFile` will actually load.
//!   - Missing / permission-denied paths surface as `Err(String)` so the frontend
//!     can fall through to the existing error path instead of crashing.
//!   - Returns `u64` directly; JS/TS handles values up to `Number.MAX_SAFE_INTEGER`
//!     (~9 PB), far above the 50 MB liability floor.

use std::fs;

#[tauri::command]
pub async fn get_file_size_bytes(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    Ok(metadata.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn reports_size_for_existing_file() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        tmp.write_all(b"hello").expect("write");
        let path = tmp.path().to_string_lossy().into_owned();

        let size = get_file_size_bytes(path).await.expect("ok");
        assert_eq!(size, 5);
    }

    #[tokio::test]
    async fn empty_file_reports_zero() {
        let tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        let path = tmp.path().to_string_lossy().into_owned();

        let size = get_file_size_bytes(path).await.expect("ok");
        assert_eq!(size, 0);
    }

    #[tokio::test]
    async fn missing_file_returns_err() {
        let result = get_file_size_bytes("/nonexistent/path/vmark-test".to_string()).await;
        assert!(result.is_err(), "expected err for missing path");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn follows_symlinks_to_real_file() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        tmp.write_all(b"abcdef").expect("write");
        let dir = tempfile::tempdir().expect("tempdir");
        let link_path = dir.path().join("link.md");
        std::os::unix::fs::symlink(tmp.path(), &link_path).expect("symlink");

        let size = get_file_size_bytes(link_path.to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert_eq!(size, 6);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broken_symlink_returns_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        let link_path = dir.path().join("broken.md");
        std::os::unix::fs::symlink("/nonexistent/target/vmark-test", &link_path)
            .expect("symlink");

        let result = get_file_size_bytes(link_path.to_string_lossy().into_owned()).await;
        assert!(result.is_err(), "broken symlinks must surface an error");
    }
}
