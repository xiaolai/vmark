// WI-1.6 (WI-1.6a vertical slice; WI-1.6b adapters) — capture: the
// editor-save vertical slice (save → identity → snapshot → ledger →
// index → restart → identical), input resolution
// with validation and on-the-fly adoption, no-op saves, and the
// append-only property over the full flow.

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{AgentType, InputRef, WriterId};
use std::path::Path;

const NOW: &str = "2026-07-18T12:00:00Z";

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    (dir, kernel)
}

fn write_file(root: &Path, rel: &str, content: &str) {
    let abs = root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, content).unwrap();
}

fn human_save(path: &str, content: &str) -> CaptureRequest {
    CaptureRequest {
        path: path.into(),
        content: content.into(),
        inputs: vec![],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "editor-save".into(),
            summary: "manual save".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
        rewrite_identity: true,
        idem: None,
    }
}

#[test]
fn vertical_slice_save_assigns_identity_snapshots_and_survives_restart() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "# Scene\nrain\n");
    let receipt = capture(&mut kernel, human_save("scene.md", "# Scene\nrain\n")).unwrap();

    // Identity was assigned and written back to disk.
    let on_disk = std::fs::read_to_string(dir.path().join("scene.md")).unwrap();
    assert!(on_disk.contains("vmark:"), "identity written to the file");
    assert_eq!(
        receipt.content_with_identity.as_deref(),
        Some(on_disk.as_str())
    );
    assert!(receipt.entry_id.is_some());

    // Snapshot exists and is the masked canonical content.
    use crate::coherence::canonical::text_content_hash;
    assert!(kernel.snapshots().contains(&text_content_hash(&on_disk)));

    // Restart: delete the index, reopen, identical state (R16 end-to-end).
    let heads_before = kernel.index().heads(&receipt.object).unwrap();
    drop(kernel);
    std::fs::remove_file(dir.path().join(".vmark/index.db")).unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    assert_eq!(kernel.index().heads(&receipt.object).unwrap(), heads_before);
    assert_eq!(heads_before, vec![receipt.revision]);
}

#[test]
fn second_save_extends_the_revision_chain() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "v1\n");
    let r1 = capture(&mut kernel, human_save("scene.md", "v1\n")).unwrap();
    // The identity rewrite changed the on-disk content; a real editor
    // buffer would now hold it. Save v2 with the identity block intact.
    let with_id = r1.content_with_identity.unwrap().replace("v1\n", "v2\n");
    write_file(dir.path(), "scene.md", &with_id);
    let r2 = capture(&mut kernel, human_save("scene.md", &with_id)).unwrap();
    assert_eq!(r1.object, r2.object);
    assert_ne!(r1.revision, r2.revision);
    assert!(
        r2.content_with_identity.is_none(),
        "identity already present"
    );
    assert_eq!(kernel.index().heads(&r1.object).unwrap(), vec![r2.revision]);
}

#[test]
fn identical_content_save_is_a_noop() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "same\n");
    let r1 = capture(&mut kernel, human_save("scene.md", "same\n")).unwrap();
    let with_id = r1.content_with_identity.unwrap();
    let r2 = capture(&mut kernel, human_save("scene.md", &with_id)).unwrap();
    assert!(r2.entry_id.is_none(), "no entry for identical content");
    assert_eq!(r2.revision, r1.revision);
}

#[test]
fn unknown_confidence_is_rejected() {
    let (_dir, mut kernel) = workspace();
    let mut req = human_save("x.md", "x\n");
    req.confidence = Confidence::Unknown;
    assert!(capture(&mut kernel, req).is_err());
}

#[test]
fn ai_generation_with_input_paths_adopts_and_records_edges() {
    // The genie flow: scene generated against an uncaptured character
    // sheet — the sheet is adopted on the fly, the edge recorded, and a
    // later sheet update surfaces the scene in the breakdown.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "elena.md", "# Elena\nEyes: green.\n");
    write_file(dir.path(), "scene.md", "# Scene\nHer green eyes.\n");

    let req = CaptureRequest {
        path: "scene.md".into(),
        content: "# Scene\nHer green eyes.\n".into(),
        inputs: vec![CaptureInputSpec {
            path: Some("elena.md".into()),
            object_id: None,
            revision: None,
            role: InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        agent: Agent {
            kind: AgentType::Model,
            id: Some("test-model".into()),
        },
        intent: Intent {
            kind: "genie".into(),
            summary: "write scene".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
        rewrite_identity: true,
        idem: None,
    };
    let receipt = capture(&mut kernel, req).unwrap();
    assert!(receipt.entry_id.is_some());

    // elena.md was adopted: identity on disk + observed-external root.
    let elena_disk = std::fs::read_to_string(dir.path().join("elena.md")).unwrap();
    assert!(elena_disk.contains("vmark:"));

    // Fresh edge — breakdown is empty.
    assert!(kernel.index().breakdown(NOW).unwrap().is_empty());

    // Update elena: the scene's edge goes version-stale.
    let elena_v2 = elena_disk.replace("green", "grey");
    write_file(dir.path(), "elena.md", &elena_v2);
    capture(&mut kernel, human_save("elena.md", &elena_v2)).unwrap();
    let rows = kernel.index().breakdown(NOW).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].upstream_path.as_deref(), Some("elena.md"));
    assert_eq!(rows[0].downstream_path.as_deref(), Some("scene.md"));
}

#[test]
fn caller_supplied_revision_is_validated() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "elena.md", "elena\n");
    let elena = capture(&mut kernel, human_save("elena.md", "elena\n")).unwrap();

    let mut req = human_save("scene.md", "scene\n");
    write_file(dir.path(), "scene.md", "scene\n");
    req.inputs = vec![CaptureInputSpec {
        path: None,
        object_id: Some(elena.object),
        revision: Some(RevisionId::parse(&format!("rev1:{}", "0".repeat(64))).unwrap()),
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }];
    let err = capture(&mut kernel, req).unwrap_err();
    assert!(err.contains("does not belong"), "no silent fallback: {err}");
}

#[test]
fn input_without_path_or_object_is_rejected() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "scene\n");
    let mut req = human_save("scene.md", "scene\n");
    req.inputs = vec![CaptureInputSpec {
        path: None,
        object_id: None,
        revision: None,
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }];
    assert!(capture(&mut kernel, req).is_err());
}

#[test]
fn rename_appends_registry_entry_not_revision() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "old.md", "content\n");
    let r1 = capture(&mut kernel, human_save("old.md", "content\n")).unwrap();
    let with_id = r1.content_with_identity.unwrap();
    // Same content saved from a new path: registry moves, chain does not.
    write_file(dir.path(), "new.md", &with_id);
    let r2 = capture(&mut kernel, human_save("new.md", &with_id)).unwrap();
    assert_eq!(r1.object, r2.object);
    assert!(r2.entry_id.is_none(), "identical content: no new revision");
    let registry = kernel.index().registry_state().unwrap();
    assert_eq!(
        registry.path_of.get(&r1.object).map(String::as_str),
        Some("new.md")
    );
}

#[test]
fn identityless_resave_at_known_path_reuses_the_object() {
    // The editor buffer does not carry the identity block in-session:
    // every save arrives identity-less. The kernel must reuse the object
    // registered at that path — never mint a second identity (§2.1/I3).
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "v1\n");
    let r1 = capture(&mut kernel, human_save("scene.md", "v1\n")).unwrap();
    // Editor saves v2 WITHOUT the identity block:
    write_file(dir.path(), "scene.md", "v2\n");
    let r2 = capture(&mut kernel, human_save("scene.md", "v2\n")).unwrap();
    assert_eq!(r1.object, r2.object, "same path, same object");
    assert!(r2.content_with_identity.is_some(), "identity re-inserted");
    assert!(
        r2.content_with_identity
            .unwrap()
            .contains(&r1.object.0.to_string()),
        "the ORIGINAL id, not a fresh one"
    );
    assert_eq!(kernel.index().heads(&r1.object).unwrap(), vec![r2.revision]);
    // And the ledger has exactly one registration for the path.
    let regs = kernel
        .ledger()
        .read_all()
        .unwrap()
        .entries
        .iter()
        .filter(|e| e.kind == "object-registered")
        .count();
    assert_eq!(regs, 1);
}

#[test]
fn buffer_capture_without_rewrite_leaves_disk_untouched() {
    // AI applies land in the editor buffer before any save. Capturing the
    // buffer must not flush it to disk (rewrite_identity=false): the
    // ledger gets the revision, the disk keeps lagging until a real save,
    // and masking makes the identity-less disk content hash-equal so scan
    // stays quiet.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "pre-apply\n");
    let r1 = capture(&mut kernel, human_save("scene.md", "pre-apply\n")).unwrap();

    let mut req = human_save("scene.md", "post-apply (buffer only)\n");
    req.agent = Agent {
        kind: AgentType::Model,
        id: Some("genie-model".into()),
    };
    req.rewrite_identity = false;
    let r2 = capture(&mut kernel, req).unwrap();

    assert_eq!(r1.object, r2.object, "registry reuse still applies");
    assert!(
        r2.content_with_identity.is_none(),
        "no rewrite, no buffer refresh"
    );
    let disk = std::fs::read_to_string(dir.path().join("scene.md")).unwrap();
    assert!(disk.contains("pre-apply"), "disk untouched: {disk:?}");
    // The buffer revision is the new head; the lagging disk content is the
    // parent revision, so a scan finds known content and mints nothing.
    let report = crate::coherence::scan::scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 0);
}

#[test]
fn malformed_frontmatter_surfaces_a_diagnostic_on_first_capture() {
    // Spec §2.1: malformed frontmatter (unterminated fence) is content,
    // not identity — the first capture surfaces a diagnostic instead of
    // silently misparsing, while history stays gap-free.
    let (dir, mut kernel) = workspace();
    let broken = "---\ntitle: Elena\nno closing fence here\n";
    write_file(dir.path(), "broken.md", broken);
    let receipt = capture(&mut kernel, human_save("broken.md", broken)).unwrap();
    assert!(receipt.entry_id.is_some(), "capture still succeeds");
    let diags: Vec<_> = kernel
        .ledger()
        .read_all()
        .unwrap()
        .entries
        .iter()
        .filter_map(|e| match e.typed().ok()? {
            crate::coherence::types::TypedBody::Diagnostic(d) => Some(d),
            _ => None,
        })
        .collect();
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].code, "malformed-frontmatter");
    assert_eq!(diags[0].path.as_deref(), Some("broken.md"));
    // A second save of the same (still-broken) file does not re-diagnose:
    // the object is already registered.
    let broken2 = format!("{broken}more\n");
    write_file(dir.path(), "broken.md", &broken2);
    capture(&mut kernel, human_save("broken.md", &broken2)).unwrap();
    let diag_count = kernel
        .ledger()
        .read_all()
        .unwrap()
        .entries
        .iter()
        .filter(|e| e.kind == "diagnostic")
        .count();
    assert_eq!(diag_count, 1);
}

#[test]
fn an_oversized_capture_is_rejected_before_any_side_effect() {
    // 8th-review 8R-9: the size preflight must fire BEFORE the identity rewrite,
    // the registration append and CAS staging. Previously an oversized payload got
    // through all three and only then failed the ledger line cap, reporting a
    // RETRYABLE error that could never succeed while those effects were durable.
    let (dir, mut kernel) = workspace();
    let original = "# doc\n";
    write_file(dir.path(), "a.md", original);

    let mut req = human_save("a.md", original);
    req.intent.summary = "x".repeat(9 * 1024); // over the 8 KiB intent cap
    let err = capture(&mut kernel, req).unwrap_err();
    assert!(err.contains("intent"), "got: {err}");

    // Nothing happened: the file was not rewritten with an identity block, and no
    // object was registered.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        original,
        "the file must not be rewritten by a rejected capture"
    );
    assert!(
        !kernel
            .index()
            .registry_state()
            .unwrap()
            .object_at
            .contains_key("a.md"),
        "a rejected capture must not register the object"
    );
}

fn path_input(path: &str) -> CaptureInputSpec {
    CaptureInputSpec {
        path: Some(path.into()),
        object_id: None,
        revision: None,
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }
}

#[test]
fn an_input_copy_of_a_still_present_tracked_document_is_held_not_moved() {
    // Audit finding #44: `b.md` is a COPY of tracked `a.md` (same vmark.id),
    // and `a.md` still exists. Adopting `b.md` as an input used to register the
    // id at `b.md` — a silent "move" — and skip the duplicate hold entirely.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "a.md", "original\n");
    let a = capture(&mut kernel, human_save("a.md", "original\n")).unwrap();
    let stamped = std::fs::read_to_string(dir.path().join("a.md")).unwrap();
    write_file(dir.path(), "b.md", &stamped);
    write_file(dir.path(), "c.md", "derived\n");
    let mut req = human_save("c.md", "derived\n");
    req.inputs = vec![path_input("b.md")];

    let err = capture(&mut kernel, req).unwrap_err();
    assert!(err.contains("duplicate"), "{err}");
    let registry = kernel.index().registry_state().unwrap();
    assert_eq!(
        registry.path_of.get(&a.object).map(String::as_str),
        Some("a.md"),
        "the registry still points at the original, not the copy"
    );
    assert!(kernel.index().is_held(&a.object).unwrap(), "capture-held");
}

#[test]
fn an_input_moved_away_from_its_tracked_path_is_re_registered() {
    // The legitimate half of #44: the original path is GONE, so this is a move.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "a.md", "original\n");
    let a = capture(&mut kernel, human_save("a.md", "original\n")).unwrap();
    std::fs::rename(dir.path().join("a.md"), dir.path().join("b.md")).unwrap();
    write_file(dir.path(), "c.md", "derived\n");
    let mut req = human_save("c.md", "derived\n");
    req.inputs = vec![path_input("b.md")];

    capture(&mut kernel, req).unwrap();
    let registry = kernel.index().registry_state().unwrap();
    assert_eq!(
        registry.path_of.get(&a.object).map(String::as_str),
        Some("b.md")
    );
    assert!(!kernel.index().is_held(&a.object).unwrap());
}

#[test]
fn a_noop_save_after_a_buffer_capture_clears_the_disk_lag() {
    // Audit finding #46: buffer capture B (disk lags at A) → real save of B,
    // which is a no-op capture → external revert to A. The no-op used to return
    // before clearing the lag, so the scan still treated A as "the buffer's
    // expected lag" and silently ignored the revert.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "v1\n");
    capture(&mut kernel, human_save("scene.md", "v1\n")).unwrap();
    let v1_on_disk = std::fs::read_to_string(dir.path().join("scene.md")).unwrap();

    let mut buffer = human_save("scene.md", "v2\n");
    buffer.rewrite_identity = false;
    capture(&mut kernel, buffer).unwrap();

    write_file(dir.path(), "scene.md", "v2\n");
    let saved = capture(&mut kernel, human_save("scene.md", "v2\n")).unwrap();
    assert!(
        saved.entry_id.is_none(),
        "the save itself is a no-op capture"
    );

    write_file(dir.path(), "scene.md", &v1_on_disk);
    let report = crate::coherence::scan::scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 1, "the external revert is recorded");
}

#[test]
fn an_input_whose_registered_original_exists_but_is_unreadable_is_refused() {
    // Round 2 of #44: an original that EXISTS but cannot be read is not proof
    // of a move. A directory at the registered path is the portable way to make
    // the read fail with something other than NotFound.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "a.md", "original\n");
    let a = capture(&mut kernel, human_save("a.md", "original\n")).unwrap();
    let stamped = std::fs::read_to_string(dir.path().join("a.md")).unwrap();
    write_file(dir.path(), "b.md", &stamped);
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    std::fs::create_dir(dir.path().join("a.md")).unwrap();
    write_file(dir.path(), "c.md", "derived\n");
    let mut req = human_save("c.md", "derived\n");
    req.inputs = vec![path_input("b.md")];

    let err = capture(&mut kernel, req).unwrap_err();
    assert!(err.contains("could not be read"), "{err}");
    let registry = kernel.index().registry_state().unwrap();
    assert_eq!(
        registry.path_of.get(&a.object).map(String::as_str),
        Some("a.md"),
        "the registry is not repointed on an unverifiable original"
    );
}

// -- the capture's own object is never one of its inputs ---------------------
//
// The webview excludes the write target by lexical path only; an alias of the
// same coherence object (named by id, or reached through a symlink or another
// spelling) survived as a self-input, recording an edge that is stale the
// moment it is written. Inputs are deduplicated by object for the same reason.

fn object_input(object: ObjectId) -> CaptureInputSpec {
    CaptureInputSpec {
        path: None,
        object_id: Some(object),
        revision: None,
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }
}

fn recorded_inputs(kernel: &WorkspaceKernel, entry: Uuid) -> Vec<InputRef> {
    let read = kernel.ledger().read_all().unwrap();
    let env = read.entries.iter().find(|e| e.id == entry).unwrap();
    let t: Transformation = serde_json::from_value(env.body.clone()).unwrap();
    assert_eq!(
        t.confidence,
        Confidence::Exact,
        "dropping a self-input loses nothing"
    );
    t.inputs
}

#[test]
fn an_input_naming_the_captures_own_object_is_dropped() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    let notes = capture(&mut kernel, human_save("notes.md", "notes\n")).unwrap();
    write_file(dir.path(), "ch1.md", "v1\n");
    let ch1 = capture(&mut kernel, human_save("ch1.md", "v1\n")).unwrap();

    let mut req = human_save("ch1.md", "v2\n");
    req.inputs = vec![object_input(ch1.object), path_input("notes.md")];
    let r = capture(&mut kernel, req).unwrap();

    let inputs = recorded_inputs(&kernel, r.entry_id.unwrap());
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].object, notes.object);
}

#[test]
fn an_input_object_named_twice_is_recorded_once() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    let notes = capture(&mut kernel, human_save("notes.md", "notes\n")).unwrap();
    write_file(dir.path(), "ch1.md", "v1\n");

    let mut req = human_save("ch1.md", "v1\n");
    req.inputs = vec![path_input("notes.md"), object_input(notes.object)];
    let r = capture(&mut kernel, req).unwrap();

    let inputs = recorded_inputs(&kernel, r.entry_id.unwrap());
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].object, notes.object);
}

/// A contextual mention named first must not swallow a later direct
/// dependency on the same object: contextual edges carry no staleness, so
/// keeping only the first would hide the downstream going stale.
#[test]
fn a_direct_input_wins_over_a_contextual_one_on_the_same_object() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes-v1\n");
    let notes = capture(&mut kernel, human_save("notes.md", "notes-v1\n")).unwrap();
    write_file(dir.path(), "ch1.md", "v1\n");

    let mut req = human_save("ch1.md", "v1\n");
    let mut contextual = object_input(notes.object);
    contextual.role = InputRole::Contextual;
    req.inputs = vec![contextual, object_input(notes.object)];
    let r = capture(&mut kernel, req).unwrap();
    let inputs = recorded_inputs(&kernel, r.entry_id.unwrap());
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].role, InputRole::Direct);

    let disk = std::fs::read_to_string(dir.path().join("notes.md")).unwrap();
    let v2 = disk.replace("notes-v1", "notes-v2");
    write_file(dir.path(), "notes.md", &v2);
    capture(&mut kernel, human_save("notes.md", &v2)).unwrap();
    let rows = crate::coherence::commands::perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1, "the advanced upstream leaves ch1 stale");
    assert!(matches!(
        rows[0].state,
        crate::coherence::project::EdgeState::VersionStale
    ));
}

#[test]
fn identical_content_whose_only_input_is_itself_is_a_noop() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "ch1.md", "v1\n");
    let ch1 = capture(&mut kernel, human_save("ch1.md", "v1\n")).unwrap();
    let stamped = ch1.content_with_identity.clone().unwrap();

    let mut req = human_save("ch1.md", &stamped);
    req.inputs = vec![object_input(ch1.object)];
    let r = capture(&mut kernel, req).unwrap();

    assert_eq!(
        r.entry_id, None,
        "no edges and no new content: an autosave replay"
    );
    assert_eq!(r.revision, ch1.revision);
}

#[cfg(unix)]
#[test]
fn an_input_reaching_the_captures_own_file_through_a_symlink_is_dropped() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "ch1.md", "v1\n");
    capture(&mut kernel, human_save("ch1.md", "v1\n")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("ch1.md"), dir.path().join("alias.md")).unwrap();

    let mut req = human_save("ch1.md", "v2\n");
    req.inputs = vec![path_input("alias.md")];
    let r = capture(&mut kernel, req).unwrap();

    assert!(recorded_inputs(&kernel, r.entry_id.unwrap()).is_empty());
}

#[cfg(unix)]
#[test]
fn an_input_read_through_a_symlink_to_a_tracked_document_is_that_document_not_a_copy() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    let notes = capture(&mut kernel, human_save("notes.md", "notes\n")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("notes.md"), dir.path().join("link.md")).unwrap();
    write_file(dir.path(), "ch1.md", "v1\n");

    let mut req = human_save("ch1.md", "v1\n");
    req.inputs = vec![path_input("link.md")];
    let r = capture(&mut kernel, req).unwrap();

    let inputs = recorded_inputs(&kernel, r.entry_id.unwrap());
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].object, notes.object);
    assert!(
        !kernel.index().is_held(&notes.object).unwrap(),
        "an alias is not a duplicate"
    );
    let registry = kernel.index().registry_state().unwrap();
    assert_eq!(
        registry.path_of.get(&notes.object).map(String::as_str),
        Some("notes.md"),
        "the registry is not repointed at the alias"
    );
}
