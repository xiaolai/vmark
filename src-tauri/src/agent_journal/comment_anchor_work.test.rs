// WI-AL3.2 — the growth tests' counter cannot go blind: every primitive that reads a text or its headings counts what it reads, at least one unit per line, byte or heading — splitting lines, reading the outline (headings and blocks), the UTF-16 encoder, the heading path at an offset, the many-quote search, the resolver's own reads of the headings (every heading at least once beyond reading the outline), and resolving and creating anchors — so a per-anchor re-read anywhere shows in `comment_list_cost`; and reading the outline of hostile definition-shaped text (titles that never close, labels and tables that cut a paragraph short) stays linear
use super::lines::split_lines;
use super::multi::occurrences_of_all;
use super::outline::{heading_path_at, outline};
use super::work::{take, utf16};
use super::{
    create_anchor, headings, resolve_all, AnchorSelection, Resolution, SelectionPrecision,
    StoredAnchor, Tier,
};
use crate::agent_journal::ids::RevisionId;

const N: usize = 500;

/// `N` lines: headings and paragraphs, so the scanner reads every kind it meets.
fn text() -> String {
    (0..N / 2).map(|i| format!("# H{i}\npara {i}\n")).collect()
}

/// The units `f` counts, from a zeroed counter.
fn counted(f: impl FnOnce()) -> u64 {
    take();
    f();
    take()
}

#[test]
fn splitting_lines_counts_every_byte() {
    let t = text();
    assert!(counted(|| drop(split_lines(&t))) >= t.len() as u64);
}

#[test]
fn reading_headings_counts_every_line() {
    let t = text();
    assert!(counted(|| drop(headings(&t))) >= N as u64);
}

#[test]
fn reading_the_outline_counts_every_byte() {
    let t = text();
    assert!(counted(|| drop(outline(&t))) >= t.len() as u64);
}

#[test]
fn encoding_counts_every_unit() {
    let t = text();
    let units = t.encode_utf16().count() as u64;
    assert!(counted(|| drop(utf16(&t))) >= units);
}

#[test]
fn the_heading_path_at_an_offset_counts_every_heading_it_passes() {
    let hs = headings(&text());
    let end = u64::MAX;
    assert!(counted(|| drop(heading_path_at(&hs, end))) >= hs.len() as u64);
}

#[test]
fn the_many_quote_search_counts_the_text() {
    let hay = utf16(&text());
    let quotes = vec![utf16("para 1")];
    assert!(counted(|| drop(occurrences_of_all(&hay, &quotes))) >= hay.len() as u64);
}

#[test]
fn resolving_counts_the_text_and_its_headings() {
    let t = text();
    // No context match, so the heading-path tier reads the headings.
    let anchor = StoredAnchor {
        quote: "para 1\n".into(),
        prefix: "nowhere".into(),
        suffix: String::new(),
        heading_path: vec!["H1".into()],
        hint: None,
    };
    assert!(counted(|| drop(resolve_all(&t, &[&anchor], None))) >= (t.len() + N) as u64);
}

#[test]
fn creating_an_anchor_counts_the_text() {
    let t = text();
    let at = AnchorSelection {
        start: 0,
        end: 3,
        precision: SelectionPrecision::Exact,
    };
    let rev = RevisionId::new();
    assert!(counted(|| drop(create_anchor(&t, &at, rev))) >= t.len() as u64);
}

#[test]
fn the_heading_path_tier_counts_a_read_per_heading_beyond_the_outline() {
    let t: String =
        (0..N).map(|i| format!("# H{i}\n\n")).collect::<String>() + "# Title\n\nhello there\n";
    // Same quote and context lengths; one decides on context, the other
    // falls through to the heading path, the only tier reading headings.
    let anchor = |prefix: &str| StoredAnchor {
        quote: "hello there".into(),
        prefix: prefix.into(),
        suffix: "\n".into(),
        heading_path: vec!["Title".into()],
        hint: None,
    };
    let (by_context, by_path) = (anchor("# Title\n\n"), anchor("nowhere!!"));
    let tier = |a: &StoredAnchor| match resolve_all(&t, &[a], None).pop() {
        Some(Resolution::Resolved { tier, .. }) => tier,
        other => panic!("{other:?}"),
    };
    assert_eq!(tier(&by_context), Tier::Context);
    assert_eq!(tier(&by_path), Tier::HeadingPath);

    let context = counted(|| drop(resolve_all(&t, &[&by_context], None)));
    let path = counted(|| drop(resolve_all(&t, &[&by_path], None)));
    let outline = counted(|| drop(headings(&t)));
    assert!(
        path - context - outline >= N as u64,
        "path {path}, context {context}, outline {outline}"
    );
}

#[test]
fn reading_hostile_definition_text_is_linear() {
    let units = [
        "[a]: b\n'x\n",
        "[a]: b 'x\n",
        "[a]: b\n(\n",
        "[x\n===\n",
        "[x\n|-|\n2. a\n",
        "[a]: b\n[c\n",
        "[a\\]\n",
    ];
    for unit in units {
        let work = |n: usize| counted(|| drop(outline(&unit.repeat(n))));
        let (small, large) = (work(N), work(4 * N));
        assert!(
            large <= 5 * small,
            "{unit:?}: {small} units at {N} repeats, {large} at {}",
            4 * N
        );
    }
}
