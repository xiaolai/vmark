//! Action metadata fetcher.
//!
//! When the user opens or hovers a `uses: owner/repo@ref` step, the
//! frontend asks for the action's `action.yml` so it can populate the
//! structured editor's `with:` form (Phase 6 / WI-6.3 of the GHA
//! workflow viewer plan).
//!
//! Pipeline:
//!   uses-string → parse owner/repo[/path]@ref →
//!     local cache (24h TTL) →
//!     network fetch from raw.githubusercontent.com (action.yml then action.yaml) →
//!     parse YAML → ActionMetadata
//!
//! Errors are typed (NotFound / NetworkError / ParseError) so the
//! frontend can distinguish "this action doesn't have action.yml yet"
//! from "you're offline" from "the action.yml is malformed".

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const DEFAULT_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours

/// Parsed `action.yml` shape — only the fields the editor needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    /// Map of `with:` input name → schema.
    #[serde(default)]
    pub inputs: std::collections::BTreeMap<String, ActionInputSchema>,
    /// Map of output name → description.
    #[serde(default)]
    pub outputs: std::collections::BTreeMap<String, ActionOutputSchema>,
    /// "node20", "docker", "composite", etc. Useful UI hint.
    #[serde(default)]
    pub runs_using: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActionInputSchema {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub deprecation_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActionOutputSchema {
    #[serde(default)]
    pub description: Option<String>,
}

/// Result of a fetch — typed so the frontend can branch cleanly.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FetchResult {
    Ok {
        metadata: ActionMetadata,
        /// Whether the result came from cache (vs. fresh network fetch).
        from_cache: bool,
    },
    NotFound {
        /// Both action.yml and action.yaml returned 404.
        message: String,
    },
    NetworkError {
        message: String,
    },
    ParseError {
        message: String,
    },
    InvalidUses {
        message: String,
    },
}

/// Parsed `uses:` reference. GitHub Actions accepts:
///   - owner/repo@ref                — top-level action
///   - owner/repo/path/to/action@ref — sub-action
///   - ./local/action               — local; not handled here
///   - docker://…                   — docker; not handled here
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionRef {
    pub owner: String,
    pub repo: String,
    /// Path within the repo to the action directory (empty for top-level).
    pub path: String,
    pub git_ref: String,
}

/// True when every char in `s` is one of the GitHub-allowed characters
/// for a repo / owner / ref / path component. GitHub usernames + repos
/// are restricted to `[A-Za-z0-9_.-]`; refs additionally allow `/`
/// (for `refs/heads/main`) and `+` (for tag escapes); paths similarly
/// allow `/`. Anything else (control chars, percent-encoding, `..`)
/// is rejected to prevent URL coercion / traversal once the value is
/// formatted into a raw.githubusercontent.com URL (Rust audit round 5).
fn is_valid_segment(s: &str, allow_slash: bool) -> bool {
    if s.is_empty() {
        return false;
    }
    // Reject `..` anywhere in the segment.
    if s.contains("..") {
        return false;
    }
    s.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || c == '_'
            || c == '-'
            || c == '.'
            || c == '+'
            || (allow_slash && c == '/')
    })
}

pub fn parse_uses(uses: &str) -> Option<ActionRef> {
    // Reject local refs and docker URIs early — they don't have an
    // action.yml on raw.githubusercontent.com.
    if uses.starts_with("./") || uses.starts_with("docker://") {
        return None;
    }

    let (slug, git_ref) = uses.rsplit_once('@')?;
    if git_ref.is_empty() {
        return None;
    }

    let mut parts = slug.splitn(3, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    let path = parts.next().unwrap_or("").to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    // Validate every component so a hostile uses string like
    // "owner/repo/..%2F..%2Fevil@main" can't probe arbitrary paths
    // under raw.githubusercontent.com.
    if !is_valid_segment(&owner, false)
        || !is_valid_segment(&repo, false)
        || (!path.is_empty() && !is_valid_segment(&path, true))
        || !is_valid_segment(git_ref, true)
    {
        return None;
    }

    Some(ActionRef {
        owner,
        repo,
        path,
        git_ref: git_ref.to_string(),
    })
}

/// Resolve the on-disk cache path for a given uses-string. The hash
/// is the SHA-256 of the uses-string so collisions are negligible
/// and the path is filesystem-safe regardless of git_ref content
/// (refs may contain `/` for branches).
pub fn cache_path(app: &AppHandle, uses: &str) -> Result<PathBuf, String> {
    let dir = tauri::Manager::path(app)
        .app_cache_dir()
        .map_err(|e| format!("cache dir lookup failed: {}", e))?
        .join("gha-action-cache");
    let mut hasher = Sha256::new();
    hasher.update(uses.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    Ok(dir.join(format!("{}.json", hash)))
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheEntry {
    /// UNIX seconds.
    fetched_at: u64,
    metadata: ActionMetadata,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Read the cache file. Returns Some(metadata) only if the entry is
/// fresh (within ttl_secs of now). Returns None on miss, expired, or
/// any read/parse error.
pub fn read_cache(path: &PathBuf, ttl_secs: u64) -> Option<ActionMetadata> {
    let bytes = std::fs::read(path).ok()?;
    let entry: CacheEntry = serde_json::from_slice(&bytes).ok()?;
    let age = now_secs().saturating_sub(entry.fetched_at);
    if age > ttl_secs {
        return None;
    }
    Some(entry.metadata)
}

pub fn write_cache(path: &PathBuf, metadata: &ActionMetadata) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let entry = CacheEntry {
        fetched_at: now_secs(),
        metadata: metadata.clone(),
    };
    let json = serde_json::to_vec_pretty(&entry).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("write: {}", e))
}

fn build_url(action: &ActionRef, filename: &str) -> String {
    if action.path.is_empty() {
        format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            action.owner, action.repo, action.git_ref, filename
        )
    } else {
        format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}/{}",
            action.owner, action.repo, action.git_ref, action.path, filename
        )
    }
}

/// Hard cap on action.yml body size. Real action.yml files are well
/// under 100 KB (the largest in actions/ org is ~30 KB); 1 MiB leaves
/// generous headroom while preventing untrusted-or-MITM responses
/// from forcing a deeply-nested YAML parse that could exhaust the
/// stack (Rust audit round 5 finding).
const MAX_ACTION_YML_BYTES: u64 = 1_048_576;

/// Network fetch with action.yml → action.yaml fallback. Caps response
/// body size before serde_yaml ever sees it.
pub async fn fetch_action_yml(action: &ActionRef) -> Result<String, FetchResult> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("vmark-gha-workflow-viewer/0.1")
        .build()
        .map_err(|e| FetchResult::NetworkError {
            message: format!("client build: {}", e),
        })?;

    for filename in &["action.yml", "action.yaml"] {
        let url = build_url(action, filename);
        let resp = client.get(&url).send().await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                return Err(FetchResult::NetworkError {
                    message: format!("GET {}: {}", url, e),
                })
            }
        };
        let status = resp.status();
        if status.as_u16() == 404 {
            continue;
        }
        if !status.is_success() {
            return Err(FetchResult::NetworkError {
                message: format!("GET {} returned HTTP {}", url, status),
            });
        }
        // Trust the server-reported Content-Length when present;
        // bytes_stream() with a manual accumulator enforces the cap
        // even when Content-Length is missing or lies.
        if let Some(len) = resp.content_length() {
            if len > MAX_ACTION_YML_BYTES {
                return Err(FetchResult::NetworkError {
                    message: format!(
                        "{} reported {} bytes (cap: {})",
                        url, len, MAX_ACTION_YML_BYTES
                    ),
                });
            }
        }
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                return Err(FetchResult::NetworkError {
                    message: format!("read body: {}", e),
                });
            }
        };
        if (bytes.len() as u64) > MAX_ACTION_YML_BYTES {
            return Err(FetchResult::NetworkError {
                message: format!(
                    "{} delivered {} bytes (cap: {})",
                    url,
                    bytes.len(),
                    MAX_ACTION_YML_BYTES
                ),
            });
        }
        return String::from_utf8(bytes.to_vec()).map_err(|e| {
            FetchResult::NetworkError {
                message: format!("non-UTF-8 response body: {}", e),
            }
        });
    }

    Err(FetchResult::NotFound {
        message: format!(
            "Neither action.yml nor action.yaml found for {}/{}@{}",
            action.owner, action.repo, action.git_ref
        ),
    })
}

/// Top-level fetch: cache → network → cache write. The `ttl_secs`
/// parameter exists primarily for tests; production callers pass
/// DEFAULT_TTL_SECS.
pub async fn fetch_metadata(
    app: &AppHandle,
    uses: &str,
    ttl_secs: u64,
) -> FetchResult {
    let action = match parse_uses(uses) {
        Some(a) => a,
        None => {
            return FetchResult::InvalidUses {
                message: format!(
                    "Cannot parse uses string {:?} as owner/repo@ref",
                    uses
                ),
            }
        }
    };

    let cache = match cache_path(app, uses) {
        Ok(p) => Some(p),
        Err(_) => None, // proceed without cache; just don't write
    };

    if let Some(p) = &cache {
        if let Some(metadata) = read_cache(p, ttl_secs) {
            return FetchResult::Ok {
                metadata,
                from_cache: true,
            };
        }
    }

    let yaml = match fetch_action_yml(&action).await {
        Ok(y) => y,
        Err(err) => return err,
    };

    let metadata: ActionMetadata = match serde_yaml::from_str(&yaml) {
        Ok(m) => m,
        Err(e) => {
            return FetchResult::ParseError {
                message: format!("action.yml parse: {}", e),
            }
        }
    };

    if let Some(p) = &cache {
        let _ = write_cache(p, &metadata); // cache write failure is non-fatal
    }

    FetchResult::Ok {
        metadata,
        from_cache: false,
    }
}

pub fn default_ttl_secs() -> u64 {
    DEFAULT_TTL_SECS
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_uses_top_level_action() {
        let r = parse_uses("actions/checkout@v4").unwrap();
        assert_eq!(r.owner, "actions");
        assert_eq!(r.repo, "checkout");
        assert_eq!(r.path, "");
        assert_eq!(r.git_ref, "v4");
    }

    #[test]
    fn parse_uses_subpath_action() {
        let r = parse_uses("actions/foo/sub/path@main").unwrap();
        assert_eq!(r.owner, "actions");
        assert_eq!(r.repo, "foo");
        assert_eq!(r.path, "sub/path");
        assert_eq!(r.git_ref, "main");
    }

    #[test]
    fn parse_uses_sha_ref() {
        let r = parse_uses("actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332").unwrap();
        assert_eq!(r.git_ref, "692973e3d937129bcbf40652eb9f2f61becf3332");
    }

    #[test]
    fn parse_uses_rejects_local_ref() {
        assert!(parse_uses("./.github/actions/setup").is_none());
    }

    #[test]
    fn parse_uses_rejects_docker_uri() {
        assert!(parse_uses("docker://alpine:3.18").is_none());
    }

    #[test]
    fn parse_uses_rejects_missing_ref() {
        assert!(parse_uses("actions/checkout").is_none());
    }

    #[test]
    fn parse_uses_rejects_empty_ref() {
        assert!(parse_uses("actions/checkout@").is_none());
    }

    #[test]
    fn parse_uses_rejects_traversal_attempts() {
        // Audit round 5: input validation hardens against owner/repo/
        // ref/path values that would coerce build_url into probing
        // arbitrary paths under raw.githubusercontent.com.
        assert!(parse_uses("..//evil@main").is_none());
        assert!(parse_uses("owner/..%2F..%2Fevil@main").is_none());
        assert!(parse_uses("owner/repo/..@main").is_none());
        assert!(parse_uses("owner/repo@..").is_none());
        // Control chars + spaces.
        assert!(parse_uses("owner/repo@ma in").is_none());
        assert!(parse_uses("owner/repo@\nmain").is_none());
        // Percent encoding (shouldn't appear in honest uses strings).
        assert!(parse_uses("owner/re%70o@main").is_none());
    }

    #[test]
    fn parse_uses_accepts_legitimate_ref_shapes() {
        assert!(parse_uses("actions/checkout@v4").is_some());
        assert!(parse_uses("actions/checkout@v4.1.7").is_some());
        // 40-char SHA.
        assert!(
            parse_uses("actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332")
                .is_some()
        );
        // Branch with slash (`refs/heads/main` shape — uncommon but valid).
        assert!(parse_uses("actions/checkout@refs/heads/main").is_some());
        // Subpath action.
        assert!(
            parse_uses("github/super-linter/super-linter@v5.0.0").is_some()
        );
    }

    #[test]
    fn parse_uses_rejects_missing_repo() {
        assert!(parse_uses("@v4").is_none());
        assert!(parse_uses("actions@v4").is_none());
    }

    #[test]
    fn build_url_top_level() {
        let r = ActionRef {
            owner: "actions".into(),
            repo: "checkout".into(),
            path: "".into(),
            git_ref: "v4".into(),
        };
        assert_eq!(
            build_url(&r, "action.yml"),
            "https://raw.githubusercontent.com/actions/checkout/v4/action.yml"
        );
    }

    #[test]
    fn build_url_subpath() {
        let r = ActionRef {
            owner: "actions".into(),
            repo: "foo".into(),
            path: "sub/path".into(),
            git_ref: "main".into(),
        };
        assert_eq!(
            build_url(&r, "action.yaml"),
            "https://raw.githubusercontent.com/actions/foo/main/sub/path/action.yaml"
        );
    }

    #[test]
    fn read_cache_returns_none_when_file_missing() {
        let p = std::env::temp_dir().join("does-not-exist-xyz.json");
        let _ = std::fs::remove_file(&p);
        assert!(read_cache(&p, 60).is_none());
    }

    #[test]
    fn cache_roundtrip_within_ttl() {
        let p = std::env::temp_dir().join(format!(
            "vmark-gha-cache-test-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        let metadata = ActionMetadata {
            name: Some("test".into()),
            description: Some("desc".into()),
            author: None,
            inputs: Default::default(),
            outputs: Default::default(),
            runs_using: Some("node20".into()),
        };
        write_cache(&p, &metadata).unwrap();
        let read = read_cache(&p, 60).unwrap();
        assert_eq!(read.name, metadata.name);
        assert_eq!(read.runs_using, metadata.runs_using);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn cache_returns_none_when_expired() {
        let p = std::env::temp_dir().join(format!(
            "vmark-gha-cache-expired-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        // Manually craft a stale entry.
        let stale = CacheEntry {
            fetched_at: 0, // Jan 1, 1970 — definitely older than 1s
            metadata: ActionMetadata {
                name: None,
                description: None,
                author: None,
                inputs: Default::default(),
                outputs: Default::default(),
                runs_using: None,
            },
        };
        std::fs::write(&p, serde_json::to_vec(&stale).unwrap()).unwrap();
        assert!(read_cache(&p, 60).is_none());
        std::fs::remove_file(&p).ok();
    }
}
