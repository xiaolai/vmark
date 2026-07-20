// Section anchors — the primitive that narrows staleness from "did the file
// change?" to "did the part I depend on change?". Measured motivation: 11 of 28
// edges reopened, several 4×, from unrelated edits to large upstreams.

use super::*;

fn p(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

const DOC: &str = "\
# Paper

Intro text.

## 5. Resolution

Body of five.

### 5.2 Waivers

Waiver rules here.

## 6. Canon

Body of six.
";

#[test]
fn a_section_resolves_to_a_stable_hash() {
    let a = resolve_anchor(DOC, &p(&["5. Resolution"]));
    assert!(matches!(a, AnchorResolution::Found(_)));
    // Same input, same hash — the comparison staleness will rely on.
    assert_eq!(a, resolve_anchor(DOC, &p(&["5. Resolution"])));
}

#[test]
fn editing_an_unrelated_section_does_not_change_the_anchor() {
    // THE POINT OF §B. Editing §6 must not restale an edge anchored to §5 —
    // that is precisely the churn that cost 4 ratifications per edge.
    let edited = DOC.replace("Body of six.", "Body of six, substantially rewritten.");
    assert_eq!(
        resolve_anchor(DOC, &p(&["5. Resolution"])),
        resolve_anchor(&edited, &p(&["5. Resolution"])),
        "an edit outside the anchored section must not move its hash"
    );
}

#[test]
fn editing_the_anchored_section_does_change_it() {
    let edited = DOC.replace("Body of five.", "Body of five, now different.");
    assert_ne!(
        resolve_anchor(DOC, &p(&["5. Resolution"])),
        resolve_anchor(&edited, &p(&["5. Resolution"])),
    );
}

#[test]
fn a_section_includes_its_subsections() {
    // Depending on "§5" means depending on all of §5 — editing 5.2 must restale
    // an edge anchored to 5.
    let edited = DOC.replace("Waiver rules here.", "Waiver rules, amended.");
    assert_ne!(
        resolve_anchor(DOC, &p(&["5. Resolution"])),
        resolve_anchor(&edited, &p(&["5. Resolution"])),
    );
}

#[test]
fn a_nested_path_resolves_to_the_subsection_only() {
    // Anchoring to 5.2 specifically must NOT be disturbed by edits elsewhere
    // in 5.
    let edited = DOC.replace("Body of five.", "Body of five, rewritten.");
    assert_eq!(
        resolve_anchor(DOC, &p(&["5. Resolution", "5.2 Waivers"])),
        resolve_anchor(&edited, &p(&["5. Resolution", "5.2 Waivers"])),
    );
}

#[test]
fn a_renamed_heading_is_not_found_rather_than_silently_refalling_back() {
    // A lost anchor is real evidence the dependency broke. Falling back to
    // whole-file would hide exactly the signal worth having.
    let edited = DOC.replace("## 5. Resolution", "## 5. Resolutions");
    assert_eq!(
        resolve_anchor(&edited, &p(&["5. Resolution"])),
        AnchorResolution::NotFound
    );
}

#[test]
fn case_changes_count_as_a_rename() {
    let edited = DOC.replace("## 5. Resolution", "## 5. resolution");
    assert_eq!(
        resolve_anchor(&edited, &p(&["5. Resolution"])),
        AnchorResolution::NotFound
    );
}

#[test]
fn duplicate_headings_are_ambiguous_not_first_wins() {
    // Picking the first match could silently start tracking the WRONG section.
    let doc = "# A\n\n## Dup\n\nfirst\n\n## Dup\n\nsecond\n";
    assert_eq!(
        resolve_anchor(doc, &p(&["Dup"])),
        AnchorResolution::Ambiguous
    );
}

#[test]
fn headings_inside_fenced_code_are_not_headings() {
    // A fenced block containing `# ...` must not register — otherwise an anchor
    // could capture code instead of prose.
    let doc = "# Real\n\nbody\n\n```sh\n# Fake heading\necho hi\n```\n\nmore body\n";
    assert_eq!(
        resolve_anchor(doc, &p(&["Fake heading"])),
        AnchorResolution::NotFound
    );
    assert!(matches!(
        resolve_anchor(doc, &p(&["Real"])),
        AnchorResolution::Found(_)
    ));
}

#[test]
fn a_tilde_fence_is_not_closed_by_a_backtick_fence() {
    let doc = "# Real\n\n~~~\n```\n# Fake\n~~~\n\ntail\n";
    assert_eq!(
        resolve_anchor(doc, &p(&["Fake"])),
        AnchorResolution::NotFound
    );
}

#[test]
fn a_hashtag_without_a_space_is_not_a_heading() {
    let doc = "# Real\n\n#nothashtag is prose\n";
    assert_eq!(
        resolve_anchor(doc, &p(&["nothashtag is prose"])),
        AnchorResolution::NotFound
    );
}

#[test]
fn closing_hashes_are_decorative() {
    let doc = "## Title ##\n\nbody\n";
    assert!(matches!(
        resolve_anchor(doc, &p(&["Title"])),
        AnchorResolution::Found(_)
    ));
}

#[test]
fn cosmetic_whitespace_edits_do_not_move_the_hash() {
    // Canonicalisation is shared with capture, so CRLF and trailing spaces are
    // not "changes" — otherwise anchors would churn as badly as whole files.
    let crlf = DOC.replace('\n', "\r\n");
    assert_eq!(
        resolve_anchor(DOC, &p(&["5. Resolution"])),
        resolve_anchor(&crlf, &p(&["5. Resolution"])),
    );
}

#[test]
fn an_empty_or_blank_path_is_invalid_not_found() {
    assert_eq!(resolve_anchor(DOC, &[]), AnchorResolution::Invalid);
    assert_eq!(resolve_anchor(DOC, &p(&["   "])), AnchorResolution::Invalid);
}

#[test]
fn a_child_segment_must_be_nested_under_its_parent() {
    // "6. Canon" is a sibling of "5. Resolution", not a child — the path must
    // not match across the tree.
    assert_eq!(
        resolve_anchor(DOC, &p(&["5. Resolution", "6. Canon"])),
        AnchorResolution::NotFound
    );
}

#[test]
fn the_last_section_runs_to_end_of_document() {
    let a = resolve_anchor(DOC, &p(&["6. Canon"]));
    assert!(matches!(a, AnchorResolution::Found(_)));
    let edited = format!("{DOC}\ntrailing addition\n");
    assert_ne!(a, resolve_anchor(&edited, &p(&["6. Canon"])));
}
