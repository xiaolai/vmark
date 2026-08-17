//! Shaping a flat heading list into the nested tree an outline needs.
//!
//! Purpose: nesting is decided entirely by heading level, and that is where a
//! section lands under the wrong parent. Kept separate from the PDF emission so
//! the shape can be tested without a PDF at all — and so `outline.rs` stays
//! under the file-size limit.
//!
//! @coordinates-with outline.rs — emits these nodes as PDF objects
//! @module pdf_export/outline_tree

/// One node of the outline tree, before it becomes PDF objects.
///
/// Kept separate from the emission step so the shape of the tree can be tested
/// without a PDF: nesting is decided entirely by heading level, and that is
/// where an off-by-one puts a section under the wrong parent.
#[derive(Debug, PartialEq)]
pub(crate) struct Node {
    pub title: String,
    /// Zero-based page index.
    pub page: usize,
    pub children: Vec<Node>,
}

/// Nest a flat, ordered heading list by level.
///
/// A level that jumps (h1 → h3 with no h2) attaches to the nearest shallower
/// ancestor rather than being dropped, and a document that opens at h2 still
/// produces roots — real documents do both.
pub(crate) fn build_tree(items: &[(u32, String, usize)]) -> Vec<Node> {
    // Levels arrive over IPC. In practice they are 1-6 because the frontend
    // reads h1..h6, but nothing in the wire type says so, and `emit` recurses
    // once per level of nesting — an absurd level would nest that deep and blow
    // the stack. Zero trust at the boundary: clamp rather than believe.
    const MAX_LEVEL: u32 = 6;
    let items: Vec<(u32, String, usize)> = items
        .iter()
        .map(|(l, t, p)| ((*l).clamp(1, MAX_LEVEL), t.clone(), *p))
        .collect();
    let items = &items[..];

    let mut roots: Vec<Node> = Vec::new();
    // Path of indices from the root down to the current insertion point,
    // paired with the level that produced each step.
    let mut path: Vec<(u32, usize)> = Vec::new();

    for (level, title, page) in items {
        while path.last().is_some_and(|(l, _)| *l >= *level) {
            path.pop();
        }
        let node = Node {
            title: title.clone(),
            page: *page,
            children: Vec::new(),
        };

        let mut cursor = &mut roots;
        for (_, idx) in &path {
            cursor = &mut cursor[*idx].children;
        }
        cursor.push(node);
        path.push((*level, cursor.len() - 1));
    }
    roots
}

#[cfg(test)]
#[path = "outline_tree.test.rs"]
mod tests;
