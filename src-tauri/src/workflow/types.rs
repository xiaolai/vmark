//! Workflow execution types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Raw YAML workflow parsed from a .yml file.
///
/// Some fields are deserialized for round-tripping but not yet consumed by
/// the executor. They're preserved so re-serialization keeps the user's YAML
/// intact.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawWorkflow {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub steps: Vec<RawStep>,
}

/// A single step in a raw workflow.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawStep {
    pub id: Option<String>,
    pub uses: String,
    #[serde(default)]
    pub with: HashMap<String, String>,
    #[serde(default)]
    pub needs: NeedsDef,
    #[serde(rename = "if")]
    pub condition: Option<String>,
    pub model: Option<String>,
    pub approval: Option<String>,
    pub limits: Option<RawLimits>,
}

/// `needs:` can be a single string or a list.
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum NeedsDef {
    #[default]
    None,
    Single(String),
    List(Vec<String>),
}

impl NeedsDef {
    pub fn to_vec(&self) -> Vec<String> {
        match self {
            NeedsDef::None => vec![],
            NeedsDef::Single(s) => vec![s.clone()],
            NeedsDef::List(v) => v.clone(),
        }
    }
}

/// Budget limits for a step.
///
/// Parsed but not yet enforced by the executor; preserved for forward-compat.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawLimits {
    pub timeout: Option<String>,
    pub max_tokens: Option<u64>,
    pub max_cost: Option<String>,
}

/// Step execution status emitted to the frontend.
#[derive(Debug, Serialize, Clone)]
pub struct StepStatusEvent {
    #[serde(rename = "executionId")]
    pub execution_id: String,
    #[serde(rename = "stepId")]
    pub step_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u64>,
}

/// Execution completion event.
#[derive(Debug, Serialize, Clone)]
pub struct ExecutionCompleteEvent {
    #[serde(rename = "executionId")]
    pub execution_id: String,
    pub status: String,
}
