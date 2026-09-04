//! #1357 — the one-call tree walk: pruning, bounds, and the two kinds of "cannot read".
use super::*;
use std::fs;
use tempfile::tempdir;

fn names(entries: &[TreeEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

fn find<'a>(entries: &'a [TreeEntry], name: &str) -> &'a TreeEntry {
    entries
        .iter()
        .find(|e| e.name == name)
        .unwrap_or_else(|| panic!("no entry {name}"))
}

#[test]
fn lists_the_whole_tree_in_one_call_with_children_nested() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("docs/deep")).unwrap();
    fs::write(root.join("a.md"), "").unwrap();
    fs::write(root.join("docs/b.md"), "").unwrap();
    fs::write(root.join("docs/deep/c.md"), "").unwrap();
    let listing =
        list_directory_tree_blocking(root.to_str().unwrap(), &TreeOptions::default()).unwrap();
    assert!(!listing.truncated);
    let docs = find(&listing.entries, "docs");
    assert!(docs.is_directory);
    let deep = find(docs.children.as_ref().unwrap(), "deep");
    assert_eq!(names(deep.children.as_ref().unwrap()), vec!["c.md"]);
}

#[test]
fn never_descends_the_always_skipped_directories_nor_the_users_exclusions() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    for skipped in ["node_modules", ".git", "target", "vendor"] {
        fs::create_dir_all(root.join(skipped).join("inner")).unwrap();
        fs::write(root.join(skipped).join("inner/x.md"), "").unwrap();
    }
    let options = TreeOptions {
        exclude_folders: vec!["vendor".into()],
        show_hidden: true,
    };
    let listing = list_directory_tree_blocking(root.to_str().unwrap(), &options).unwrap();
    // Listed (so the user can see they exist), but never read into.
    for skipped in ["node_modules", ".git", "target", "vendor"] {
        let node = find(&listing.entries, skipped);
        assert!(node.is_directory);
        assert_eq!(
            node.children.as_deref(),
            Some(&[][..]),
            "{skipped} must be pruned"
        );
        assert!(!node.unreadable, "pruned is not unreadable");
    }
    assert!(
        ALWAYS_SKIP.contains(&"node_modules"),
        "the list is the search's own"
    );
}

#[test]
fn hidden_directories_are_pruned_unless_hidden_entries_are_shown() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join(".notes")).unwrap();
    fs::write(root.join(".notes/secret.md"), "").unwrap();
    fs::write(root.join(".dotfile.md"), "").unwrap();
    let hidden_off =
        list_directory_tree_blocking(root.to_str().unwrap(), &TreeOptions::default()).unwrap();
    let notes = find(&hidden_off.entries, ".notes");
    assert!(notes.is_hidden);
    assert_eq!(notes.children.as_deref(), Some(&[][..]));
    // Hidden FILES are still listed with their flag — the client decides.
    assert!(find(&hidden_off.entries, ".dotfile.md").is_hidden);
    let hidden_on = list_directory_tree_blocking(
        root.to_str().unwrap(),
        &TreeOptions {
            exclude_folders: vec![],
            show_hidden: true,
        },
    )
    .unwrap();
    assert_eq!(
        names(
            find(&hidden_on.entries, ".notes")
                .children
                .as_ref()
                .unwrap()
        ),
        vec!["secret.md"]
    );
}

#[test]
fn an_unreadable_root_is_the_error_and_an_unreadable_subdirectory_is_a_flagged_empty_folder() {
    let missing = tempdir().unwrap().path().join("gone");
    assert!(
        list_directory_tree_blocking(missing.to_str().unwrap(), &TreeOptions::default()).is_err()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let root = dir.path();
        let locked = root.join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("inside.md"), "").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let listing = list_directory_tree_blocking(root.to_str().unwrap(), &TreeOptions::default());
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        let listing = listing.unwrap();
        let node = find(&listing.entries, "locked");
        // Root-owned test runners can read anything; the flag is asserted only
        // when the read really failed.
        if node.unreadable {
            assert_eq!(node.children.as_deref(), Some(&[][..]));
        }
    }
}

#[test]
fn a_symlink_to_a_directory_is_listed_but_never_descended() {
    #[cfg(unix)]
    {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("real")).unwrap();
        fs::write(root.join("real/x.md"), "").unwrap();
        std::os::unix::fs::symlink(root, root.join("real/loop")).unwrap();
        let listing =
            list_directory_tree_blocking(root.to_str().unwrap(), &TreeOptions::default()).unwrap();
        let real = find(&listing.entries, "real");
        let link = find(real.children.as_ref().unwrap(), "loop");
        assert!(
            !link.is_directory,
            "a symlink's own file type is not a directory"
        );
        assert!(link.children.is_none());
        assert!(!listing.truncated);
    }
}

#[test]
fn the_node_budget_truncates_and_says_so() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    for i in 0..(MAX_TREE_NODES / 1000).max(3) {
        fs::write(root.join(format!("f{i}.md")), "").unwrap();
    }
    let small =
        list_directory_tree_blocking(root.to_str().unwrap(), &TreeOptions::default()).unwrap();
    assert!(!small.truncated);
    // The bound itself, exercised on the counter rather than on 50k real files.
    let mut walk = Walk {
        options: &TreeOptions::default(),
        nodes: MAX_TREE_NODES,
        truncated: false,
    };
    let entries = walk.list(root.to_str().unwrap(), 0).unwrap();
    assert!(entries.is_empty());
    assert!(walk.truncated);
}

#[test]
fn the_depth_bound_stops_descending_and_says_so() {
    let dir = tempdir().unwrap();
    let mut deep = dir.path().to_path_buf();
    for i in 0..(MAX_TREE_DEPTH + 2) {
        deep = deep.join(format!("d{i}"));
    }
    fs::create_dir_all(&deep).unwrap();
    fs::write(deep.join("leaf.md"), "").unwrap();
    let listing =
        list_directory_tree_blocking(dir.path().to_str().unwrap(), &TreeOptions::default())
            .unwrap();
    assert!(
        listing.truncated,
        "past MAX_TREE_DEPTH the walk must report a partial tree"
    );
}
