//! The versioned provenance payload (`provenanceVersion` 1): an
//! accumulator body wrapped with what it is a map OF — document, editing
//! epoch, basis, and the SHA-256 of the preimage and postimage. Decoding
//! validates every field rule, so a payload value that exists is valid.

use serde::{Deserialize, Serialize};

use super::body::Body;
use super::{Provenance, MIN_PROVENANCE_CAP, PROVENANCE_CAP};
use crate::agent_journal::hunk_id::text_hash;
use crate::agent_journal::text::utf16_len;

const PROVENANCE_VERSION: u32 = 1;
const UNIT: &str = "utf16CodeUnit";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "PayloadWire"
)]
pub struct ProvenancePayload {
    provenance_version: u32,
    unit: String,
    cap: u64,
    document: String,
    epoch: String,
    basis: String,
    pre_hash: String,
    post_hash: String,
    body: Body,
}

/// The unvalidated wire shape; same fields, same order.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PayloadWire {
    provenance_version: u32,
    unit: String,
    cap: u64,
    document: String,
    epoch: String,
    basis: String,
    pre_hash: String,
    post_hash: String,
    body: Body,
}

impl TryFrom<PayloadWire> for ProvenancePayload {
    type Error = String;
    fn try_from(w: PayloadWire) -> Result<Self, String> {
        let p = Self {
            provenance_version: w.provenance_version,
            unit: w.unit,
            cap: w.cap,
            document: w.document,
            epoch: w.epoch,
            basis: w.basis,
            pre_hash: w.pre_hash,
            post_hash: w.post_hash,
            body: w.body,
        };
        p.validate()?;
        Ok(p)
    }
}

/// A selection edit's certificate: a payload without the document, epoch
/// and basis, which the window cannot know before the writer mints the
/// parent. Decoding validates every other field rule; `bind` names them.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "CertificateWire")]
pub struct Certificate(ProvenancePayload);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CertificateWire {
    provenance_version: u32,
    unit: String,
    cap: u64,
    pre_hash: String,
    post_hash: String,
    body: Body,
}

/// The placeholder ids an unbound certificate is validated under.
const UNBOUND: &str = "unbound";

impl TryFrom<CertificateWire> for Certificate {
    type Error = String;
    fn try_from(w: CertificateWire) -> Result<Self, String> {
        PayloadWire {
            provenance_version: w.provenance_version,
            unit: w.unit,
            cap: w.cap,
            document: UNBOUND.into(),
            epoch: "0".into(),
            basis: UNBOUND.into(),
            pre_hash: w.pre_hash,
            post_hash: w.post_hash,
            body: w.body,
        }
        .try_into()
        .map(Self)
    }
}

impl Certificate {
    /// The SHA-256 (bare hex) of the text the certificate maps from.
    pub fn pre_hash(&self) -> &str {
        &self.0.pre_hash
    }

    /// The UTF-16 length of the text the certificate maps from.
    pub fn len_a(&self) -> u64 {
        self.0.body.len_a
    }

    /// The payload this certificate is once bound to `document`, `epoch`
    /// and `basis`.
    pub fn bind(
        self,
        document: &str,
        epoch: &str,
        basis: &str,
    ) -> Result<ProvenancePayload, String> {
        check_ids(document, epoch, basis)?;
        Ok(ProvenancePayload {
            document: document.into(),
            epoch: epoch.into(),
            basis: basis.into(),
            ..self.0
        })
    }
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl ProvenancePayload {
    fn validate(&self) -> Result<(), String> {
        if self.provenance_version != PROVENANCE_VERSION {
            return Err(format!(
                "unsupported provenanceVersion {}",
                self.provenance_version
            ));
        }
        if self.unit != UNIT {
            return Err("unsupported unit".into());
        }
        if !(MIN_PROVENANCE_CAP..=PROVENANCE_CAP).contains(&self.cap) {
            return Err(format!("malformed cap {}", self.cap));
        }
        check_ids(&self.document, &self.epoch, &self.basis)?;
        if !is_hex64(&self.pre_hash) || !is_hex64(&self.post_hash) {
            return Err("malformed preHash/postHash".into());
        }
        // Before rebuilding: a hostile body is refused on its size alone.
        if self.body.canonical_entries() as u64 > 2 * self.cap {
            return Err("provenance body exceeds its cap".into());
        }
        Provenance::decode(&self.body, self.cap).map(|_| ())
    }

    /// Wraps an accumulator; `pre` / `post` are the texts it maps between.
    pub fn encode(
        document: &str,
        epoch: &str,
        basis: &str,
        pre: &str,
        post: &str,
        p: &Provenance,
    ) -> Result<Self, String> {
        let body = p.encode();
        if body.len_a != utf16_len(pre) || body.len_b != utf16_len(post) {
            return Err("provenance lengths do not match its texts".into());
        }
        check_ids(document, epoch, basis)?;
        Ok(Self {
            provenance_version: PROVENANCE_VERSION,
            unit: UNIT.into(),
            cap: p.cap(),
            document: document.into(),
            epoch: epoch.into(),
            basis: basis.into(),
            pre_hash: text_hash(pre),
            post_hash: text_hash(post),
            body,
        })
    }

    /// Rebuilds the accumulator (cannot fail for a decoded payload).
    pub fn accumulator(&self) -> Result<Provenance, String> {
        Provenance::decode(&self.body, self.cap)
    }

    /// The payload maps exactly `pre` → `post`: hashes, lengths, and every
    /// surviving character (`Provenance::check_texts`).
    pub fn check_texts(&self, pre: &str, post: &str) -> Result<(), String> {
        self.checked_accumulator(pre, post).map(|_| ())
    }

    /// `check_texts`, returning the accumulator it rebuilt to check them,
    /// so a caller that goes on to use the map decodes it once.
    pub fn checked_accumulator(&self, pre: &str, post: &str) -> Result<Provenance, String> {
        if text_hash(pre) != self.pre_hash || utf16_len(pre) != self.body.len_a {
            return Err("preimage does not match".into());
        }
        if text_hash(post) != self.post_hash || utf16_len(post) != self.body.len_b {
            return Err("postimage does not match".into());
        }
        let units = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
        let window = self.accumulator()?;
        window.check_texts(&units(pre), &units(post))?;
        Ok(window)
    }

    /// No character deleted, no gap touched, no break: the map certifies
    /// that every character of the old text is still in place.
    pub fn touches_nothing(&self) -> bool {
        let b = &self.body;
        b.deleted_chars.is_empty()
            && b.touched_gaps.is_empty()
            && b.breaks.whole.is_none()
            && b.breaks.bounded.is_empty()
    }

    pub fn document(&self) -> &str {
        &self.document
    }

    pub fn epoch(&self) -> u64 {
        crate::agent_journal::u64_wire::parse(&self.epoch).expect("validated epoch")
    }

    pub fn basis(&self) -> &str {
        &self.basis
    }

    /// The SHA-256 (bare hex) of the text the payload maps from.
    pub fn pre_hash(&self) -> &str {
        &self.pre_hash
    }
}

fn check_ids(document: &str, epoch: &str, basis: &str) -> Result<(), String> {
    if document.is_empty() {
        return Err("malformed document".into());
    }
    if crate::agent_journal::u64_wire::parse(epoch).is_none() {
        return Err(format!("malformed epoch {epoch:?}"));
    }
    if basis.is_empty() {
        return Err("malformed basis".into());
    }
    Ok(())
}
