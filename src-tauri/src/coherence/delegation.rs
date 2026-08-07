//! Delegation lifecycle (WI-3.3; design-3.md D2, spec §5.4.7 rev 2).
//! Kernel tier: grants bind a scope to the authenticated bridge
//! principal with a REQUIRED expiry; revocation is supersession with an
//! empty scope (append-only, I5). `live_delegation_for` is the single
//! authorization gate the mutating MCP surface consults — fail closed
//! on expiry, revocation, scope, and principal alike.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::state::WorkspaceKernel;
use super::types::Envelope;

/// The scopes Phase 3 recognizes — claim/context mutation is
/// deliberately absent (D2.5: canon stays human-controlled).
pub const KNOWN_SCOPES: [&str; 2] = ["resolve.accept-newer", "resolve.waive"];

#[derive(Debug, Clone)]
pub struct DelegationEntry {
    pub entry_id: Uuid,
    pub grant: Uuid,
    pub delegate: String,
    pub scope: Vec<String>,
    pub expires: String,
    pub supersedes: Option<Uuid>,
    sort_key: (chrono::DateTime<chrono::FixedOffset>, Uuid),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DelegationConflict {
    pub grant: Uuid,
    pub superseded: Uuid,
    pub rivals: Vec<Uuid>,
}

#[derive(Debug, Default)]
pub struct DelegationStore {
    by_grant: std::collections::HashMap<Uuid, Vec<DelegationEntry>>,
    conflicts: Vec<DelegationConflict>,
}

impl DelegationStore {
    pub fn from_entries(entries: &[Envelope]) -> Self {
        let mut by_grant: std::collections::HashMap<Uuid, Vec<DelegationEntry>> =
            std::collections::HashMap::new();
        for env in entries {
            if env.kind != "delegation" {
                continue;
            }
            let Some(parsed) = parse_delegation(env) else {
                continue; // malformed known-kind quarantined at read
            };
            by_grant.entry(parsed.grant).or_default().push(parsed);
        }
        let mut conflicts = Vec::new();
        for (grant, list) in by_grant.iter_mut() {
            list.sort_by_key(|e| e.sort_key);
            let mut by_target: std::collections::HashMap<Uuid, Vec<Uuid>> =
                std::collections::HashMap::new();
            for e in list.iter() {
                if let Some(t) = e.supersedes {
                    by_target.entry(t).or_default().push(e.entry_id);
                }
            }
            for (superseded, rivals) in by_target {
                if rivals.len() > 1 {
                    conflicts.push(DelegationConflict {
                        grant: *grant,
                        superseded,
                        rivals,
                    });
                }
            }
        }
        conflicts.sort_by_key(|c| c.grant);
        Self {
            by_grant,
            conflicts,
        }
    }

    fn current(&self, grant: Uuid) -> Option<&DelegationEntry> {
        let list = self.by_grant.get(&grant)?;
        let superseded: std::collections::HashSet<Uuid> =
            list.iter().filter_map(|e| e.supersedes).collect();
        list.iter()
            .rev()
            .find(|e| !superseded.contains(&e.entry_id))
    }

    /// D2.4's gate: current ∧ unexpired ∧ unrevoked (non-empty scope) ∧
    /// scope-covering ∧ principal-matching. Any failure → None.
    pub fn live_delegation_for(
        &self,
        principal: &str,
        scope: &str,
        now: &str,
    ) -> Option<&DelegationEntry> {
        let now = chrono::DateTime::parse_from_rfc3339(now).ok()?;
        self.by_grant
            .keys()
            .filter_map(|g| self.current(*g))
            .find(|e| {
                e.delegate == principal
                    && e.scope.iter().any(|s| s == scope)
                    && chrono::DateTime::parse_from_rfc3339(&e.expires)
                        .map(|exp| exp > now)
                        .unwrap_or(false)
            })
    }

    pub fn all_current(&self) -> Vec<&DelegationEntry> {
        let mut out: Vec<&DelegationEntry> = self
            .by_grant
            .keys()
            .filter_map(|g| self.current(*g))
            .collect();
        out.sort_by_key(|e| e.sort_key);
        out
    }

    pub fn conflicts(&self) -> &[DelegationConflict] {
        &self.conflicts
    }
}

fn parse_delegation(env: &Envelope) -> Option<DelegationEntry> {
    let b = &env.body;
    Some(DelegationEntry {
        entry_id: env.id,
        grant: Uuid::parse_str(b.get("delegation")?.as_str()?).ok()?,
        delegate: b.get("delegate")?.get("id")?.as_str()?.to_string(),
        scope: b
            .get("scope")?
            .as_array()?
            .iter()
            .filter_map(|s| s.as_str().map(str::to_string))
            .collect(),
        expires: b.get("expires")?.as_str()?.to_string(),
        supersedes: b
            .get("supersedes")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok()),
        sort_key: env.sort_key()?,
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct DelegateRequest {
    /// The authenticated bridge principal being empowered.
    pub delegate: String,
    pub scope: Vec<String>,
    /// REQUIRED, RFC 3339, in the future (spec §5.4.7).
    pub expires: String,
    /// Present = revoke this grant (scope is forced empty).
    #[serde(default)]
    pub revoke: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegateReceipt {
    pub grant: Uuid,
    pub entry_id: Uuid,
}

/// Grant or revoke — in-app explicit human acts only (D2.2).
pub fn perform_delegate(
    kernel: &mut WorkspaceKernel,
    req: &DelegateRequest,
    actor: &str,
    now: &str,
) -> Result<DelegateReceipt, String> {
    // R1 (7th-review 6R-1): read + build delegation + append atomic under the lock.
    kernel.with_write_lock(|kernel| perform_delegate_locked(kernel, req, actor, now))
}

fn perform_delegate_locked(
    kernel: &mut WorkspaceKernel,
    req: &DelegateRequest,
    actor: &str,
    now: &str,
) -> Result<DelegateReceipt, String> {
    let expires = chrono::DateTime::parse_from_rfc3339(&req.expires)
        .map_err(|e| format!("expires must be RFC 3339: {e}"))?;
    let now_parsed =
        chrono::DateTime::parse_from_rfc3339(now).map_err(|e| format!("clock: {e}"))?;
    let (grant, scope, supersedes) = match req.revoke {
        Some(grant) => {
            let read = kernel.ledger().read_all()?;
            let store = DelegationStore::from_entries(&read.entries);
            let current = store
                .current(grant)
                .ok_or_else(|| format!("unknown grant: {grant}"))?;
            (grant, Vec::new(), Some(current.entry_id))
        }
        None => {
            if expires <= now_parsed {
                return Err("a grant's expiry must be in the future".into());
            }
            if req.scope.is_empty() {
                return Err("a grant needs a non-empty scope".into());
            }
            for s in &req.scope {
                if !KNOWN_SCOPES.contains(&s.as_str()) {
                    return Err(format!("unknown scope: {s:?}"));
                }
            }
            if req.delegate.trim().is_empty() {
                return Err("a grant needs a delegate principal".into());
            }
            (Uuid::now_v7(), req.scope.clone(), None)
        }
    };
    kernel.ensure_initialized()?;
    let body = json!({
        "delegation": grant.to_string(),
        "actor": { "type": "human", "id": actor },
        "delegate": { "type": "external", "id": req.delegate },
        "scope": scope,
        "expires": req.expires,
        "supersedes": supersedes.map(|s| s.to_string()),
    });
    let env = Envelope::create("delegation", kernel.writer(), body);
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    Ok(DelegateReceipt { grant, entry_id })
}

#[cfg(test)]
#[path = "delegation.test.rs"]
mod tests;
