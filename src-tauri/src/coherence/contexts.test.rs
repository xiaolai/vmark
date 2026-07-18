// WI-2b.1 — context manifests: load/validate + effective view as a delta
// over the Phase 1 projection (design-2a.md D1; spec §6 revision 1).

use super::*;
use crate::coherence::dag::Selection;
use crate::coherence::types::{ObjectId, RevisionId};
use std::collections::HashMap;
use uuid::Uuid;

fn ctx_dir() -> (tempfile::TempDir, std::path::PathBuf) {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path().join("contexts");
    std::fs::create_dir_all(&dir).expect("mkdir");
    (td, dir)
}

fn manifest(id: Uuid, name: &str, parent: Option<Uuid>) -> ContextManifest {
    ContextManifest {
        format: 0,
        id,
        name: name.into(),
        parent,
        selections: HashMap::new(),
        enforcement: Enforcement::Greenhouse,
        visible_claims: Vec::new(),
    }
}

fn rev(n: u8) -> RevisionId {
    RevisionId::parse(&format!("rev1:{}", hex(n))).expect("revision")
}

fn hex(n: u8) -> String {
    format!("{:02x}", n).repeat(32)
}

#[test]
fn missing_dir_is_default_only() {
    let td = tempfile::tempdir().unwrap();
    let set = ContextSet::load(&td.path().join("contexts"));
    assert!(set.errors.is_empty());
    let (view, errs) = set.effective_view(DEFAULT_CONTEXT_ID);
    assert!(errs.is_empty());
    let obj = ObjectId(Uuid::now_v7());
    assert_eq!(view.selection(&obj.0.into_object()), &Selection::Live);
}

#[test]
fn enforcement_defaults_to_greenhouse_when_missing() {
    let (_td, dir) = ctx_dir();
    let id = Uuid::now_v7();
    // Hand-written JSON without the enforcement field.
    std::fs::write(
        dir.join("a.json"),
        format!(
            r#"{{"format":0,"id":"{id}","name":"a","parent":null,"selections":{{}},"visible_claims":[]}}"#
        ),
    )
    .unwrap();
    let set = ContextSet::load(&dir);
    assert!(set.errors.is_empty(), "{:?}", set.errors);
    assert_eq!(
        set.manifests.get(&id).unwrap().enforcement,
        Enforcement::Greenhouse
    );
}

#[test]
fn child_selection_overrides_parent_and_absent_is_live() {
    let (_td, dir) = ctx_dir();
    let (pid, cid) = (Uuid::now_v7(), Uuid::now_v7());
    let (obj_a, obj_b, obj_c) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    let mut parent = manifest(pid, "parent", None);
    parent.selections.insert(obj_a, format!("rev1:{}", hex(1)));
    parent.selections.insert(obj_b, format!("rev1:{}", hex(2)));
    let mut child = manifest(cid, "child", Some(pid));
    child.selections.insert(obj_a, format!("rev1:{}", hex(3)));
    write_manifest(&dir, &parent).unwrap();
    write_manifest(&dir, &child).unwrap();

    let set = ContextSet::load(&dir);
    let (view, errs) = set.effective_view(cid);
    assert!(errs.is_empty(), "{errs:?}");
    // Child wins for obj_a; parent supplies obj_b; obj_c falls to live.
    assert_eq!(view.selection(&obj(obj_a)), &Selection::Pinned(rev(3)));
    assert_eq!(view.selection(&obj(obj_b)), &Selection::Pinned(rev(2)));
    assert_eq!(view.selection(&obj(obj_c)), &Selection::Live);
}

fn obj(id: Uuid) -> ObjectId {
    ObjectId(id)
}

#[test]
fn cycle_degrades_to_default_and_surfaces_error() {
    let (_td, dir) = ctx_dir();
    let (a, b) = (Uuid::now_v7(), Uuid::now_v7());
    let mut ma = manifest(a, "a", Some(b));
    ma.selections
        .insert(Uuid::now_v7(), format!("rev1:{}", hex(1)));
    let mb = manifest(b, "b", Some(a));
    write_manifest(&dir, &ma).unwrap();
    write_manifest(&dir, &mb).unwrap();

    let set = ContextSet::load(&dir);
    let (view, errs) = set.effective_view(a);
    assert_eq!(errs.len(), 1);
    assert!(errs[0].reason.contains("cycle"), "{:?}", errs[0]);
    // Degraded to the implicit default: everything live.
    let o = ObjectId(Uuid::now_v7());
    assert_eq!(view.selection(&o), &Selection::Live);
}

#[test]
fn chain_overflow_degrades_to_default() {
    let (_td, dir) = ctx_dir();
    let ids: Vec<Uuid> = (0..18).map(|_| Uuid::now_v7()).collect();
    for (i, id) in ids.iter().enumerate() {
        let parent = if i + 1 < ids.len() {
            Some(ids[i + 1])
        } else {
            None
        };
        write_manifest(&dir, &manifest(*id, &format!("c{i}"), parent)).unwrap();
    }
    let set = ContextSet::load(&dir);
    let (_, errs) = set.effective_view(ids[0]);
    assert_eq!(errs.len(), 1);
    assert!(errs[0].reason.contains("chain"), "{:?}", errs[0]);
}

#[test]
fn visible_claims_union_is_additive_and_deduped() {
    let (_td, dir) = ctx_dir();
    let (pid, cid) = (Uuid::now_v7(), Uuid::now_v7());
    let (cl1, cl2) = (Uuid::now_v7(), Uuid::now_v7());
    let mut parent = manifest(pid, "parent", None);
    parent.visible_claims = vec![cl1, cl2];
    let mut child = manifest(cid, "child", Some(pid));
    child.visible_claims = vec![cl2]; // duplicate of parent's
    write_manifest(&dir, &parent).unwrap();
    write_manifest(&dir, &child).unwrap();

    let set = ContextSet::load(&dir);
    let claims = set.effective_claims(cid);
    // Child cannot hide cl1; cl2 contributes once.
    assert_eq!(claims.len(), 2);
    assert!(claims.contains(&cl1) && claims.contains(&cl2));
}

#[test]
fn unknown_context_id_is_default_with_error() {
    let (_td, dir) = ctx_dir();
    let set = ContextSet::load(&dir);
    let missing = Uuid::now_v7();
    let (view, errs) = set.effective_view(missing);
    assert_eq!(errs.len(), 1);
    assert!(errs[0].reason.contains("unknown"), "{:?}", errs[0]);
    assert_eq!(view.selection(&ObjectId(Uuid::now_v7())), &Selection::Live);
}

#[test]
fn invalid_selection_value_is_surfaced_and_treated_live() {
    let (_td, dir) = ctx_dir();
    let id = Uuid::now_v7();
    let o = Uuid::now_v7();
    let mut m = manifest(id, "bad-sel", None);
    m.selections.insert(o, "not-a-revision".into());
    write_manifest(&dir, &m).unwrap();
    let set = ContextSet::load(&dir);
    let (view, errs) = set.effective_view(id);
    assert_eq!(errs.len(), 1);
    assert!(errs[0].reason.contains("selection"), "{:?}", errs[0]);
    assert_eq!(view.selection(&ObjectId(o)), &Selection::Live);
}

#[test]
fn write_manifest_is_atomic_and_roundtrips() {
    let (_td, dir) = ctx_dir();
    let id = Uuid::now_v7();
    let mut m = manifest(id, "roundtrip", None);
    m.selections.insert(Uuid::now_v7(), "live".into());
    m.visible_claims = vec![Uuid::now_v7()];
    write_manifest(&dir, &m).unwrap();
    // No temp litter left behind.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains("tmp"))
        .collect();
    assert!(leftovers.is_empty());
    let set = ContextSet::load(&dir);
    assert_eq!(set.manifests.get(&id).unwrap().name, "roundtrip");
}

#[test]
fn materialized_default_manifest_is_consulted() {
    let (_td, dir) = ctx_dir();
    let claim = Uuid::now_v7();
    let mut m = manifest(DEFAULT_CONTEXT_ID, "default", None);
    m.visible_claims = vec![claim];
    write_manifest(&dir, &m).unwrap();
    let set = ContextSet::load(&dir);
    let (_, errs) = set.effective_view(DEFAULT_CONTEXT_ID);
    assert!(errs.is_empty(), "{errs:?}");
    assert!(set.effective_claims(DEFAULT_CONTEXT_ID).contains(&claim));
}

#[test]
fn malformed_manifest_file_is_error_not_panic() {
    let (_td, dir) = ctx_dir();
    std::fs::write(dir.join("broken.json"), "{ not json").unwrap();
    let set = ContextSet::load(&dir);
    assert_eq!(set.errors.len(), 1);
    assert!(
        set.errors[0].reason.contains("parse"),
        "{:?}",
        set.errors[0]
    );
}

// Helper so Selection comparisons read naturally above.
trait IntoObject {
    fn into_object(self) -> ObjectId;
}
impl IntoObject for Uuid {
    fn into_object(self) -> ObjectId {
        ObjectId(self)
    }
}
