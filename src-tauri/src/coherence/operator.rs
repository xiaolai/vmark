//! Forward-operator runtime (Phase 3, WI-3.2; design D1/D5). Operators are
//! **built-in Rust** `fn(selection, read-view) -> Vec<Candidate>` (not Tier-1
//! schema-pack functions — SP3/D5). A `Candidate` is one fully-specified output
//! over a single-head base: content-addressed (D1), with the base recorded as a
//! **parent, never an input** (recording it as an input would mint an
//! immediately-stale self-edge — N2). Candidates are in-memory only; nothing
//! here touches the ledger or CAS until accept.

use sha2::{Digest, Sha256};

use super::types::{
    Agent, Confidence, ContentHash, InputRef, Intent, ObjectId, OutputRef, RevisionId,
    Transformation,
};

/// A proposed output — fully specified, content-addressed, not yet committed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub object: ObjectId,
    pub content: String,
    pub content_hash: ContentHash,
    pub revision: RevisionId,
    /// The base revision this candidate supersedes — a PARENT, never an input.
    pub parents: Vec<RevisionId>,
    /// Declared inputs (may be empty for a pure single-object revision).
    pub inputs: Vec<InputRef>,
    pub operator: String,
    pub summary: String,
}

impl Candidate {
    /// Build a candidate output over a single-head `base`. `content_hash` and
    /// `revision` are computed (content-addressed, D1). The base is the sole
    /// parent — it is **not** added to `inputs`.
    pub fn new(
        object: ObjectId,
        content: String,
        base: RevisionId,
        inputs: Vec<InputRef>,
        operator: &str,
        summary: &str,
    ) -> Self {
        let digest: [u8; 32] = Sha256::digest(content.as_bytes()).into();
        let content_hash = ContentHash::from_digest(&digest);
        let parents = vec![base];
        let revision = RevisionId::compute(&content_hash, &parents);
        Self {
            object,
            content,
            content_hash,
            revision,
            parents,
            inputs,
            operator: operator.to_string(),
            summary: summary.to_string(),
        }
    }

    /// The single output this candidate produces on accept.
    pub fn to_output(&self) -> OutputRef {
        OutputRef {
            object: self.object,
            revision: self.revision.clone(),
            content_hash: self.content_hash.clone(),
            parents: self.parents.clone(),
        }
    }

    /// The transformation an accept appends (one output, `intent.kind =
    /// operator:<name>`). Human-authored agent; confidence Exact (a deterministic
    /// operator's output is exact over its inputs).
    pub fn to_transformation(&self, agent: Agent) -> Transformation {
        Transformation {
            inputs: self.inputs.clone(),
            outputs: vec![self.to_output()],
            agent,
            intent: Intent {
                kind: format!("operator:{}", self.operator),
                summary: self.summary.clone(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        }
    }
}

/// The first built-in operator (D5): a **simple deterministic single-object
/// text-tidy revision**. Produces up to two candidates over the single-head
/// base — (1) trailing whitespace trimmed per line; (2) that plus collapsing
/// runs of blank lines to one. A candidate identical to the current text is
/// dropped (nothing to propose). Deterministic: same input → same candidates.
pub fn tidy_revise(object: ObjectId, base: RevisionId, current: &str) -> Vec<Candidate> {
    let trimmed = trim_trailing(current);
    let collapsed = collapse_blanks(&trimmed);

    let mut out = Vec::new();
    if trimmed != current {
        out.push(Candidate::new(
            object,
            trimmed.clone(),
            base.clone(),
            vec![],
            "tidy",
            "trim trailing whitespace",
        ));
    }
    if collapsed != current && collapsed != trimmed {
        out.push(Candidate::new(
            object,
            collapsed,
            base,
            vec![],
            "tidy",
            "trim trailing whitespace and collapse blank lines",
        ));
    }
    out
}

fn trim_trailing(text: &str) -> String {
    let mut lines: Vec<&str> = text.lines().map(|l| l.trim_end()).collect();
    // Preserve a single trailing newline if the input had one.
    let s = lines.join("\n");
    if text.ends_with('\n') {
        lines.clear();
        format!("{s}\n")
    } else {
        s
    }
}

fn collapse_blanks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_blank = false;
    let trailing_nl = text.ends_with('\n');
    for line in text.lines() {
        let blank = line.trim().is_empty();
        if blank && prev_blank {
            continue;
        }
        out.push_str(line);
        out.push('\n');
        prev_blank = blank;
    }
    if !trailing_nl && out.ends_with('\n') {
        out.pop();
    }
    out
}

#[cfg(test)]
#[path = "operator.test.rs"]
mod tests;
