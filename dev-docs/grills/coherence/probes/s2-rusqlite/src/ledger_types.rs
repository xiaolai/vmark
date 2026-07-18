// Read-side ledger entry shapes (spec §5.3 envelope, §5.4 bodies) and the
// SQLite index DDL. The DDL is the spike's WI-1.5 schema recommendation.

use serde::Deserialize;
use serde_json::value::RawValue;

/// Index schema. Objects and revisions are interned to INTEGER keys during
/// the scan; TEXT identity (uuid / rev1:) is kept once per row for display
/// and re-resolution. `head_anc` materializes strict head-ancestry only for
/// objects with > 64 revisions (spec §9.3); `obj_heads` caches head count,
/// the single head (when unique), and revision count per object.
pub const SCHEMA: &str = "
PRAGMA user_version = 1;
CREATE TABLE objects   (oid INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE);
CREATE TABLE revisions (rid INTEGER PRIMARY KEY, object INTEGER NOT NULL,
                        rev TEXT NOT NULL, txf TEXT, UNIQUE(object, rev));
CREATE TABLE parents   (rid INTEGER NOT NULL, parent INTEGER NOT NULL,
                        PRIMARY KEY (rid, parent)) WITHOUT ROWID;
CREATE TABLE edges     (eid INTEGER PRIMARY KEY, txf TEXT NOT NULL,
                        input_idx INTEGER NOT NULL, upstream INTEGER NOT NULL,
                        pinned INTEGER NOT NULL, downstream INTEGER NOT NULL,
                        out_rev INTEGER NOT NULL, role INTEGER NOT NULL);
CREATE TABLE heads     (object INTEGER NOT NULL, rev INTEGER NOT NULL,
                        PRIMARY KEY (object, rev)) WITHOUT ROWID;
CREATE TABLE obj_heads (object INTEGER PRIMARY KEY, n INTEGER NOT NULL,
                        h1 INTEGER, revs INTEGER NOT NULL);
CREATE TABLE head_anc  (head INTEGER NOT NULL, anc INTEGER NOT NULL,
                        PRIMARY KEY (head, anc)) WITHOUT ROWID;
CREATE TABLE resolved  (txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
                        against INTEGER NOT NULL, kind INTEGER NOT NULL,
                        PRIMARY KEY (txf, input_idx, against)) WITHOUT ROWID;
";

#[derive(Deserialize)]
pub struct Env<'a> {
    pub id: &'a str,
    pub kind: &'a str,
    pub time: &'a str,
    pub idem: &'a str,
    #[serde(borrow)]
    pub body: &'a RawValue,
}

#[derive(Deserialize)]
pub struct InputIn<'a> {
    pub object: &'a str,
    pub revision: &'a str,
    pub role: &'a str,
}

#[derive(Deserialize)]
pub struct OutputIn<'a> {
    pub object: &'a str,
    pub revision: &'a str,
    #[serde(default)]
    pub parents: Vec<&'a str>,
}

#[derive(Deserialize)]
pub struct TxfBody<'a> {
    #[serde(borrow)]
    pub inputs: Vec<InputIn<'a>>,
    #[serde(borrow)]
    pub outputs: Vec<OutputIn<'a>>,
}

#[derive(Deserialize)]
pub struct EdgeRef<'a> {
    pub txf: &'a str,
    pub input: u32,
}

#[derive(Deserialize)]
pub struct ResBody<'a> {
    #[serde(borrow)]
    pub edge: EdgeRef<'a>,
    pub upstream_object: &'a str,
    pub resolved_against: &'a str,
}
