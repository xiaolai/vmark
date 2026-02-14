#!/usr/bin/env bash
# codex-preflight.sh — Discover available Codex models by probing in parallel.
#
# Usage:  bash scripts/codex-preflight.sh
# Output: JSON to stdout  (human summary to stderr)
#
# Caching: Results are cached for 5 minutes in $TMPDIR/codex-preflight-cache.json.
#          Set CODEX_PREFLIGHT_NO_CACHE=1 to skip cache.
#
# How it works:
#   Invalid models fail fast (~1s) with "not supported" in stderr.
#   Valid models start processing (no error within timeout) — we kill & mark available.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

PROBE_TIMEOUT=5          # seconds to wait before declaring "available"
CLOUD_TIMEOUT=5          # seconds to wait for codex cloud list
CACHE_TTL=300            # seconds (5 minutes)
PROBE_PROMPT="Respond with ok."

# Candidate models — stale entries are harmless (probe as unavailable).
# Add new model names here as OpenAI releases them.
# ORDER MATTERS: within each family, list newest version FIRST.
# The dedup step keeps only the first available model per family.
CANDIDATE_MODELS=(
  # gpt-codex family (newest first)
  gpt-5.3-codex
  gpt-5.2-codex
  # gpt-codex-spark family
  gpt-5.3-codex-spark
  # gpt-codex-max family
  gpt-5.1-codex-max
  # gpt-codex-mini family
  gpt-5-codex-mini
  # o-mini family
  o4-mini
  # o family
  o3
  # standalone
  codex-mini-latest
  # gpt (non-codex) family
  gpt-4.1
  # gpt-mini (non-codex) family
  gpt-4.1-mini
)

# Static options (stable CLI flags — no need to probe).
REASONING_EFFORTS='["low","medium","high"]'
SANDBOX_LEVELS='["read-only","workspace-write","danger-full-access"]'

# ── Helpers ──────────────────────────────────────────────────────────────────

info() { echo "$*" >&2; }

# Escape a string for safe JSON interpolation (handles quotes, backslashes, newlines).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"     # backslashes
  s="${s//\"/\\\"}"     # double quotes
  s="${s//$'\n'/\\n}"   # newlines
  s="${s//$'\r'/}"      # carriage returns
  s="${s//$'\t'/\\t}"   # tabs
  printf '%s' "$s"
}

# Resolve the timeout command (timeout on Linux, gtimeout on macOS via coreutils).
resolve_timeout_cmd() {
  if command -v timeout &>/dev/null; then
    echo "timeout"
  elif command -v gtimeout &>/dev/null; then
    echo "gtimeout"
  else
    echo ""
  fi
}

# Map a model name to its family (version stripped).
# Within each family, only the newest available model is kept.
get_family() {
  local model="$1"
  case "$model" in
    gpt-*-codex-spark) echo "gpt-codex-spark" ;;
    gpt-*-codex-max)   echo "gpt-codex-max"   ;;
    gpt-*-codex-mini)  echo "gpt-codex-mini"  ;;
    gpt-*-codex)       echo "gpt-codex"        ;;
    gpt-*-mini)        echo "gpt-mini"         ;;
    gpt-[0-9]*)        echo "gpt"              ;;
    o[0-9]*-mini)      echo "o-mini"           ;;
    o[0-9]*)           echo "o"                ;;
    *)                 echo "$model"           ;; # unique — no family
  esac
}

# Build a JSON array from positional arguments. Handles empty arrays correctly.
json_array() {
  if [[ $# -eq 0 ]]; then
    echo "[]"
    return
  fi
  local result="["
  local first=true
  for item in "$@"; do
    if $first; then first=false; else result+=","; fi
    result+="\"$item\""
  done
  result+="]"
  echo "$result"
}

# ── Step 0: Check cache ─────────────────────────────────────────────────────

CACHE_FILE="${TMPDIR:-/tmp}/codex-preflight-cache.json"

if [[ -z "${CODEX_PREFLIGHT_NO_CACHE:-}" && -f "$CACHE_FILE" ]]; then
  # Check if cache is fresh (< CACHE_TTL seconds old)
  if [[ "$(uname)" == "Darwin" ]]; then
    cache_age=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE") ))
  else
    cache_age=$(( $(date +%s) - $(stat -c %Y "$CACHE_FILE") ))
  fi

  if [[ $cache_age -lt $CACHE_TTL ]]; then
    info "Using cached results (${cache_age}s old, TTL ${CACHE_TTL}s)"
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# ── Step 1: Check codex CLI ──────────────────────────────────────────────────

if ! command -v codex &>/dev/null; then
  cat <<'JSON'
{"status":"error","error":"codex CLI not found. Install: npm install -g @openai/codex","models":[],"reasoning_efforts":[],"sandbox_levels":[]}
JSON
  exit 1
fi

# ── Step 2: Get codex version ────────────────────────────────────────────────

CODEX_VERSION=$(codex --version 2>/dev/null || echo "unknown")
info "Codex version: $CODEX_VERSION"

# ── Step 3: Check authentication ─────────────────────────────────────────────

AUTH_MODE="unknown"

# Prefer `codex login status` (available in v0.101+) over parsing auth.json directly.
LOGIN_STATUS=$(codex login status 2>&1) || true
if echo "$LOGIN_STATUS" | grep -qi "logged in"; then
  # Extract auth mode from status output if possible
  if echo "$LOGIN_STATUS" | grep -qi "chatgpt"; then
    AUTH_MODE="chatgpt_login"
  elif echo "$LOGIN_STATUS" | grep -qi "api.key\|api_key"; then
    AUTH_MODE="api_key"
  else
    AUTH_MODE="authenticated"
  fi
elif echo "$LOGIN_STATUS" | grep -qi "not logged in\|not authenticated"; then
  AUTH_MODE="unknown"
else
  # Fallback: parse auth.json directly (older Codex versions)
  AUTH_FILE="$HOME/.codex/auth.json"
  if [[ -f "$AUTH_FILE" ]]; then
    if command -v jq &>/dev/null; then
      AUTH_MODE=$(jq -r '.auth_mode // "unknown"' "$AUTH_FILE" 2>/dev/null || echo "unknown")
    else
      AUTH_MODE=$(grep -o '"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$AUTH_FILE" 2>/dev/null \
        | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "unknown")
    fi
  fi
fi

# Only fall back to API key if no subscription auth was found.
# Subscription (codex login) is preferred — it reflects the user's actual plan.
if [[ "$AUTH_MODE" == "unknown" && -n "${OPENAI_API_KEY:-}" ]]; then
  AUTH_MODE="api_key"
fi

if [[ "$AUTH_MODE" == "unknown" ]]; then
  CODEX_VERSION_SAFE=$(json_escape "$CODEX_VERSION")
  cat <<JSON
{"status":"error","error":"Not authenticated. Run: codex login","auth_mode":"none","codex_version":"$CODEX_VERSION_SAFE","models":[],"reasoning_efforts":$REASONING_EFFORTS,"sandbox_levels":$SANDBOX_LEVELS}
JSON
  exit 1
fi

info "Auth mode: $AUTH_MODE"
info "Probing ${#CANDIDATE_MODELS[@]} candidate models (timeout ${PROBE_TIMEOUT}s each)..."

# ── Step 4: Probe models in parallel ─────────────────────────────────────────

TMPDIR_PROBE=$(mktemp -d)
trap 'kill 0 2>/dev/null; rm -rf "$TMPDIR_PROBE"' EXIT

TIMEOUT_CMD=$(resolve_timeout_cmd)

probe_model() {
  local model="$1"
  local outfile="$TMPDIR_PROBE/$model"
  local stderr_file="$TMPDIR_PROBE/${model}.stderr"

  if [[ -n "$TIMEOUT_CMD" ]]; then
    $TIMEOUT_CMD "$PROBE_TIMEOUT" \
      codex exec -m "$model" "$PROBE_PROMPT" \
      >"$outfile" 2>"$stderr_file" &
  else
    # Manual timeout fallback (no coreutils)
    (
      codex exec -m "$model" "$PROBE_PROMPT" \
        >"$outfile" 2>"$stderr_file"
    ) &
    local pid=$!
    (
      sleep "$PROBE_TIMEOUT"
      kill "$pid" 2>/dev/null
    ) &
    local killer=$!
    wait "$pid" 2>/dev/null
    kill "$killer" 2>/dev/null
    wait "$killer" 2>/dev/null
  fi
}

# Launch all probes in parallel
for model in "${CANDIDATE_MODELS[@]}"; do
  probe_model "$model" &
done

# Wait for all background probes
wait

# ── Step 5: Collect and deduplicate results ──────────────────────────────────

AVAILABLE=()
UNAVAILABLE=()

for model in "${CANDIDATE_MODELS[@]}"; do
  stderr_file="$TMPDIR_PROBE/${model}.stderr"
  if [[ -f "$stderr_file" ]] && grep -qi "not supported" "$stderr_file" 2>/dev/null; then
    UNAVAILABLE+=("$model")
    info "  $model  -->  unavailable"
  else
    AVAILABLE+=("$model")
    info "  $model  -->  available"
  fi
done

# Deduplicate — keep only newest per family.
# CANDIDATE_MODELS is ordered newest-first within each family, so the first
# available model we see for a family is the newest. Older versions move to
# UNAVAILABLE (with a "superseded" note).

SEEN_FAMILIES=""
FILTERED=()
for model in "${AVAILABLE[@]}"; do
  family=$(get_family "$model")
  if echo "$SEEN_FAMILIES" | grep -qF "|${family}|"; then
    UNAVAILABLE+=("$model")
    info "  $model  -->  superseded (keeping newer from $family family)"
  else
    FILTERED+=("$model")
    SEEN_FAMILIES="${SEEN_FAMILIES}|${family}|"
  fi
done

# Correctly handle empty arrays (bash "${arr[@]}" expands to "" when empty)
if [[ ${#FILTERED[@]} -gt 0 ]]; then
  AVAILABLE=("${FILTERED[@]}")
else
  AVAILABLE=()
fi

# ── Step 6: Check Codex Cloud availability ───────────────────────────────────

CODEX_CLOUD="false"
if [[ -n "$TIMEOUT_CMD" ]]; then
  if $TIMEOUT_CMD "$CLOUD_TIMEOUT" codex cloud list &>/dev/null; then
    CODEX_CLOUD="true"
  fi
else
  # No timeout command available — skip cloud check rather than risk hanging
  info "  Skipping cloud check (no timeout command available)"
fi

# ── Step 7: Output JSON ─────────────────────────────────────────────────────

available_json=$(json_array "${AVAILABLE[@]+"${AVAILABLE[@]}"}")
unavailable_json=$(json_array "${UNAVAILABLE[@]+"${UNAVAILABLE[@]}"}")

CODEX_VERSION_SAFE=$(json_escape "$CODEX_VERSION")
AUTH_MODE_SAFE=$(json_escape "$AUTH_MODE")

OUTPUT=$(cat <<JSON
{"status":"ok","codex_version":"$CODEX_VERSION_SAFE","auth_mode":"$AUTH_MODE_SAFE","codex_cloud":$CODEX_CLOUD,"models":$available_json,"unavailable":$unavailable_json,"reasoning_efforts":$REASONING_EFFORTS,"sandbox_levels":$SANDBOX_LEVELS}
JSON
)

# Write to cache and stdout
echo "$OUTPUT" > "$CACHE_FILE"
echo "$OUTPUT"
