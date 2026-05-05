//! Approval gate (ADR-4 / WI-3.1).
//!
//! When a workflow step's effective `approval` resolves to "ask", the runner
//! emits `workflow:approval-request` to the frontend and parks on a
//! `tokio::sync::oneshot` receiver. The frontend's dialog calls the
//! `respond_workflow_approval` Tauri command, which sends on the matching
//! sender. The runner resumes; the step proceeds on `true`, fails on `false`
//! or timeout.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

/// Key for an outstanding approval request: `(execution_id, step_id)`.
pub type ApprovalKey = (String, String);

/// Holds outstanding approval senders. Lives on `WorkflowRunnerState`.
#[derive(Default)]
pub struct ApprovalRegistry {
    senders: Mutex<HashMap<ApprovalKey, oneshot::Sender<bool>>>,
}

impl ApprovalRegistry {
    /// Create an empty registry. Equivalent to `Default::default()`; the
    /// explicit constructor reads better at the `WorkflowRunnerState`
    /// initialization site in `lib.rs`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a fresh oneshot for `(execution_id, step_id)` and return the
    /// receiver. The caller awaits the receiver; the matching
    /// `respond_workflow_approval` call sends.
    pub fn register(&self, key: ApprovalKey) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.senders
            .lock()
            .expect("approval registry mutex poisoned")
            .insert(key, tx);
        rx
    }

    /// Respond to an outstanding approval. Returns `true` if a sender was
    /// found and the response was delivered, `false` if no such request
    /// existed or the receiver had already been dropped.
    pub fn respond(&self, key: &ApprovalKey, approved: bool) -> bool {
        let sender = self
            .senders
            .lock()
            .expect("approval registry mutex poisoned")
            .remove(key);
        match sender {
            Some(tx) => tx.send(approved).is_ok(),
            None => false,
        }
    }

    /// Drop any pending approval sender for `(execution_id, step_id)`. Called
    /// by the runner when a step is skipped or its parent execution is
    /// cancelled, so the receiver collapses cleanly into `Err`.
    pub fn drop_pending(&self, key: &ApprovalKey) {
        self.senders
            .lock()
            .expect("approval registry mutex poisoned")
            .remove(key);
    }
}

/// Payload emitted via `workflow:approval-request`.
#[derive(Debug, Clone, Serialize)]
pub struct ApprovalRequest {
    #[serde(rename = "executionId")]
    pub execution_id: String,
    #[serde(rename = "stepId")]
    pub step_id: String,
    /// Short summary the dialog can title with — typically the step's
    /// `uses:` value (e.g. "genie/improve-clarity").
    pub summary: String,
    /// First N chars of the filled prompt, for the dialog preview pane.
    pub preview: String,
    /// Resolved model name (None means provider default).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_then_respond_yields_true() {
        let reg = ApprovalRegistry::new();
        let key = ("e1".to_string(), "s1".to_string());
        let rx = reg.register(key.clone());
        assert!(reg.respond(&key, true));
        let v = rx.await.unwrap();
        assert!(v);
    }

    #[tokio::test]
    async fn register_then_respond_yields_false() {
        let reg = ApprovalRegistry::new();
        let key = ("e1".to_string(), "s1".to_string());
        let rx = reg.register(key.clone());
        assert!(reg.respond(&key, false));
        assert!(!rx.await.unwrap());
    }

    #[test]
    fn respond_unknown_key_returns_false() {
        let reg = ApprovalRegistry::new();
        assert!(!reg.respond(&("x".into(), "y".into()), true));
    }

    #[tokio::test]
    async fn drop_pending_collapses_receiver_to_err() {
        let reg = ApprovalRegistry::new();
        let key = ("e1".to_string(), "s1".to_string());
        let rx = reg.register(key.clone());
        reg.drop_pending(&key);
        // Sender side dropped — receiver resolves to Err(RecvError).
        assert!(rx.await.is_err());
    }

    #[test]
    fn respond_after_drop_returns_false() {
        let reg = ApprovalRegistry::new();
        let key = ("e1".to_string(), "s1".to_string());
        let _rx = reg.register(key.clone());
        reg.drop_pending(&key);
        assert!(!reg.respond(&key, true));
    }
}
