//! Unit tests for `workspace.rs` (config serde, path hashing, legacy
//! migration). Split to an external file via `#[path]` to keep
//! `workspace.rs` under its size baseline (see 00-engineering-principles).

    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_hash_root_path_deterministic() {
        let h1 = hash_root_path("/Users/test/project");
        let h2 = hash_root_path("/Users/test/project");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 32); // 16 bytes = 32 hex chars
    }

    #[test]
    fn test_legacy_hash_root_path_unchanged_8_bytes() {
        // The legacy helper exists for migration; its output must remain
        // exactly 16 hex chars / 8 bytes so it matches files produced by
        // previous releases.
        let h = legacy_hash_root_path("/Users/test/project");
        assert_eq!(h.len(), 16);
    }

    #[test]
    fn test_new_hash_differs_from_legacy() {
        // 16-byte hash must not collide with the 8-byte prefix — this is
        // what makes the new path distinct from the old one for migration.
        let new_h = hash_root_path("/Users/test/project");
        let legacy_h = legacy_hash_root_path("/Users/test/project");
        assert_ne!(new_h, legacy_h);
        assert!(
            new_h.starts_with(&legacy_h),
            "new hash should extend the legacy prefix"
        );
    }

    #[test]
    fn test_hash_root_path_normalizes_trailing_slash() {
        let h1 = hash_root_path("/Users/test/project");
        let h2 = hash_root_path("/Users/test/project/");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_root_path_normalizes_trailing_backslash() {
        let h1 = hash_root_path("C:\\Users\\test\\project");
        let h2 = hash_root_path("C:\\Users\\test\\project\\");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_root_path_different_paths_differ() {
        let h1 = hash_root_path("/Users/test/project-a");
        let h2 = hash_root_path("/Users/test/project-b");
        assert_ne!(h1, h2);
    }

    // ----- hash-filename migration -----------------------------------------
    //
    // Exercises `try_rename_legacy_hash` (the AppHandle-free helper extracted
    // from `migrate_legacy_hash_filename`) on every branch: already migrated,
    // no legacy file present, successful rename, and rename failure.

    #[test]
    fn migration_already_migrated_when_new_path_exists() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("aaaaaaaaaaaaaaaa.json");
        let new_path = dir.path().join("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb.json");
        fs::write(&legacy, b"{}").unwrap();
        fs::write(&new_path, b"{\"current\": true}").unwrap();

        let outcome = try_rename_legacy_hash(&legacy, &new_path);
        assert_eq!(outcome, HashMigrationOutcome::AlreadyMigrated);
        // Legacy file untouched — we did not clobber.
        assert!(legacy.exists());
        let new_contents = fs::read_to_string(&new_path).unwrap();
        assert!(new_contents.contains("current"));
    }

    #[test]
    fn migration_no_op_when_no_legacy_file() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("aaaaaaaaaaaaaaaa.json");
        let new_path = dir.path().join("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb.json");

        let outcome = try_rename_legacy_hash(&legacy, &new_path);
        assert_eq!(outcome, HashMigrationOutcome::NoLegacyFile);
        assert!(!new_path.exists());
    }

    #[test]
    fn migration_renames_legacy_to_new_path() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("aaaaaaaaaaaaaaaa.json");
        let new_path = dir.path().join("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb.json");
        let payload = b"{\"legacy\": true}";
        fs::write(&legacy, payload).unwrap();

        let outcome = try_rename_legacy_hash(&legacy, &new_path);
        assert_eq!(outcome, HashMigrationOutcome::Renamed);
        assert!(!legacy.exists(), "legacy file must be gone after rename");
        assert!(new_path.exists(), "new path must contain the renamed file");
        let new_contents = fs::read(&new_path).unwrap();
        assert_eq!(new_contents.as_slice(), payload);
    }

    #[test]
    fn migration_reports_failure_when_rename_target_is_invalid() {
        // Forcing fs::rename to fail is OS-specific; the cleanest cross-platform
        // way is to give it a target path whose parent directory does not exist.
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("aaaaaaaaaaaaaaaa.json");
        let new_path = dir
            .path()
            .join("missing-subdir/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb.json");
        fs::write(&legacy, b"{}").unwrap();

        let outcome = try_rename_legacy_hash(&legacy, &new_path);
        assert_eq!(outcome, HashMigrationOutcome::RenameFailed);
        // Legacy file must be left in place on failure — the next attempt
        // can retry. Losing the legacy file would lose user state.
        assert!(legacy.exists(), "legacy file must survive a failed rename");
    }

    #[test]
    fn test_default_workspace_config() {
        let config = WorkspaceConfig::default();
        assert_eq!(config.version, 1);
        assert!(config.exclude_folders.contains(&".git".to_string()));
        assert!(config.exclude_folders.contains(&"node_modules".to_string()));
        assert!(!config.exclude_folders.contains(&".vmark".to_string()));
        assert!(!config.show_hidden_files);
        assert!(config.last_open_tabs.is_empty());
    }

    #[test]
    fn test_migrate_from_legacy_directory_format() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create .vmark/vmark.code-workspace
        let vmark_dir = root.join(".vmark");
        fs::create_dir_all(&vmark_dir).unwrap();
        let ws_content = r#"{
            "folders": [{"path": "."}],
            "settings": {
                "vmark.excludeFolders": [".git", "node_modules", ".vmark"],
                "vmark.showHiddenFiles": true,
                "vmark.lastOpenTabs": ["doc.md"]
            }
        }"#;
        fs::write(vmark_dir.join("vmark.code-workspace"), ws_content).unwrap();

        let config = migrate_from_legacy(root.to_str().unwrap())
            .unwrap()
            .unwrap();
        assert!(config.show_hidden_files);
        assert!(config.last_open_tabs.contains(&"doc.md".to_string()));
        // .vmark should be stripped from exclude_folders
        assert!(!config.exclude_folders.contains(&".vmark".to_string()));
        assert!(config.exclude_folders.contains(&".git".to_string()));
    }

    #[test]
    fn test_migrate_from_legacy_ancient_file_format() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create .vmark as plain file
        let legacy_content = r#"{
            "version": 1,
            "excludeFolders": ["legacy_folder", ".vmark"],
            "lastOpenTabs": ["old.md"]
        }"#;
        fs::write(root.join(".vmark"), legacy_content).unwrap();

        let config = migrate_from_legacy(root.to_str().unwrap())
            .unwrap()
            .unwrap();
        assert!(config
            .exclude_folders
            .contains(&"legacy_folder".to_string()));
        assert!(!config.exclude_folders.contains(&".vmark".to_string()));
        assert!(config.last_open_tabs.contains(&"old.md".to_string()));
    }

    #[test]
    fn test_migrate_from_legacy_nothing() {
        let dir = tempdir().unwrap();
        let result = migrate_from_legacy(dir.path().to_str().unwrap()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_cleanup_old_vmark_directory() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create .vmark directory with workspace file
        let vmark_dir = root.join(".vmark");
        fs::create_dir_all(&vmark_dir).unwrap();
        fs::write(vmark_dir.join("vmark.code-workspace"), "{}").unwrap();

        cleanup_old_vmark(root.to_str().unwrap());

        // Directory should be removed (was empty after file removal)
        assert!(!vmark_dir.exists());
    }

    #[test]
    fn test_cleanup_old_vmark_directory_non_empty() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create .vmark directory with extra file
        let vmark_dir = root.join(".vmark");
        fs::create_dir_all(&vmark_dir).unwrap();
        fs::write(vmark_dir.join("vmark.code-workspace"), "{}").unwrap();
        fs::write(vmark_dir.join("other-file"), "keep").unwrap();

        cleanup_old_vmark(root.to_str().unwrap());

        // Directory should still exist (has other files)
        assert!(vmark_dir.exists());
        // But workspace file should be gone
        assert!(!vmark_dir.join("vmark.code-workspace").exists());
    }

    #[test]
    fn test_cleanup_old_vmark_file() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create .vmark as plain file
        fs::write(root.join(".vmark"), "{}").unwrap();

        cleanup_old_vmark(root.to_str().unwrap());

        assert!(!root.join(".vmark").exists());
    }

    #[test]
    fn test_workspace_config_serialization_roundtrip() {
        let config = WorkspaceConfig {
            version: 1,
            exclude_folders: vec!["test".to_string()],
            show_hidden_files: true,
            last_open_tabs: vec!["file.md".to_string()],
            session_tabs: None,
            ai: None,
            identity: None,
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let back: WorkspaceConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(back.exclude_folders, config.exclude_folders);
        assert_eq!(back.show_hidden_files, config.show_hidden_files);
        assert_eq!(back.last_open_tabs, config.last_open_tabs);
    }

    // WI-1.1 — sessionTabs is opaque to Rust but must round-trip losslessly so
    // the TS-side versioned records survive a read→write cycle.
    #[test]
    fn test_workspace_config_session_tabs_roundtrip() {
        let session = serde_json::json!({
            "version": 1,
            "tabs": [
                { "kind": "document", "path": "/a.md" },
                { "kind": "browser", "url": "https://example.com/", "title": "Example" }
            ]
        });
        let config = WorkspaceConfig {
            session_tabs: Some(session.clone()),
            ..WorkspaceConfig::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("sessionTabs"), "sessionTabs must serialize under its JSON name");
        let back: WorkspaceConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_tabs, Some(session));
    }

    // Absent sessionTabs stays absent (skip_serializing_if) — an older config
    // is not rewritten with a null field, and stays byte-compatible.
    #[test]
    fn test_workspace_config_session_tabs_absent_is_omitted() {
        let config = WorkspaceConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains("sessionTabs"), "absent sessionTabs must not serialize");
        let back: WorkspaceConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_tabs, None);
    }

    // Downgrade tolerance: a config carrying an UNKNOWN future field (as a newer
    // build might write) still deserializes — serde ignores unknown fields.
    #[test]
    fn test_workspace_config_tolerates_unknown_future_field() {
        let json = r#"{
            "version": 1,
            "excludeFolders": [],
            "lastOpenTabs": ["/a.md"],
            "sessionTabs": { "version": 1, "tabs": [] },
            "someFutureField": { "nested": true }
        }"#;
        let back: WorkspaceConfig = serde_json::from_str(json).unwrap();
        assert_eq!(back.last_open_tabs, vec!["/a.md".to_string()]);
        assert!(back.session_tabs.is_some());
    }
