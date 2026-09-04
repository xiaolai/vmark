//! Audit 20260903 round 4, #37 — the attachment state the authority reports, and
//! the wire shape the frontend mirror re-syncs from.

use super::*;

fn surface_with_tab(tab_id: &str, generation: u64) -> BrowserSurface {
    let s = BrowserSurface::default();
    let mut reg = s.registry.lock().unwrap();
    reg.create(tab_id, "main").unwrap();
    while reg.generation(tab_id).unwrap() < generation {
        reg.bump_generation(tab_id).unwrap();
    }
    drop(reg);
    s
}

#[test]
fn an_unknown_or_unattached_tab_is_detached_with_no_fields() {
    let s = surface_with_tab("t1", 0);
    assert_eq!(s.attachment_state("t1").unwrap(), AttachmentState::DETACHED);
    assert_eq!(
        s.attachment_state("ghost").unwrap(),
        AttachmentState::DETACHED
    );
}

#[test]
fn a_one_use_attachment_reports_its_generation_and_once_until_it_is_spent() {
    let s = surface_with_tab("t1", 3);
    s.attach_tab("t1".into(), 3, true).unwrap();
    assert_eq!(
        s.attachment_state("t1").unwrap(),
        AttachmentState {
            attached: true,
            generation: Some(3),
            once: Some(true),
        }
    );
    // The consume the authorization gate performs (`authorize_spend.rs`).
    assert!(crate::browser::surface::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        3
    ));
    assert_eq!(
        s.attachment_state("t1").unwrap(),
        AttachmentState::DETACHED,
        "a spent one-use attachment is gone — this is the answer the mirror could only guess at"
    );
}

#[test]
fn a_persistent_attachment_survives_a_consume_and_says_once_false() {
    let s = surface_with_tab("t1", 1);
    s.attach_tab("t1".into(), 1, false).unwrap();
    let expected = AttachmentState {
        attached: true,
        generation: Some(1),
        once: Some(false),
    };
    assert_eq!(s.attachment_state("t1").unwrap(), expected);
    assert!(crate::browser::surface::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        1
    ));
    assert_eq!(s.attachment_state("t1").unwrap(), expected);
}

#[test]
fn navigation_and_forget_clear_the_reported_state() {
    let s = surface_with_tab("t1", 0);
    s.attach_tab("t1".into(), 0, false).unwrap();
    // What the navigation delegate does when a load starts.
    s.clear_tab_attachment("t1");
    assert_eq!(s.attachment_state("t1").unwrap(), AttachmentState::DETACHED);

    s.attach_tab("t1".into(), 0, true).unwrap();
    s.forget_tab("t1").unwrap();
    assert_eq!(s.attachment_state("t1").unwrap(), AttachmentState::DETACHED);
}

#[test]
fn only_the_asked_tab_is_reported() {
    let s = surface_with_tab("t1", 0);
    s.registry.lock().unwrap().create("t2", "main").unwrap();
    s.attach_tab("t2".into(), 0, true).unwrap();
    assert_eq!(s.attachment_state("t1").unwrap(), AttachmentState::DETACHED);
    assert!(s.attachment_state("t2").unwrap().attached);
}

#[test]
fn the_wire_shape_is_what_the_frontend_mirror_reads() {
    // `browserAttachmentMirror.ts` is written against exactly these three keys, with
    // `null` (not absence) for the fields a detached tab has no value for.
    let attached = AttachmentState {
        attached: true,
        generation: Some(3),
        once: Some(true),
    };
    assert_eq!(
        serde_json::to_value(&attached).unwrap(),
        serde_json::json!({ "attached": true, "generation": 3, "once": true })
    );
    assert_eq!(
        serde_json::to_value(AttachmentState::DETACHED).unwrap(),
        serde_json::json!({ "attached": false, "generation": null, "once": null })
    );
}
