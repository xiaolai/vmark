#!/usr/bin/env bash
#
# Fetch a curated set of real-world GitHub Actions workflows for the
# Phase 1 fixture corpus. Each fixture exercises a specific surface
# documented inline. Run once; check in the result.
#
# Usage: bash scripts/fetch-gha-fixtures.sh
# Output: dev-docs/fixtures/gha-workflows/<repo-slug>/<workflow>.yml

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dev-docs/fixtures/gha-workflows"

# Each line: <subdir> <local-name> <raw-url>
# Pinned to specific commits so the corpus is reproducible.
FIXTURES=(
  # actions/checkout — pull_request_target, multi-OS matrix
  "actions-checkout test.yml https://raw.githubusercontent.com/actions/checkout/v4/.github/workflows/test.yml"
  # actions/setup-node — versions matrix, schedule trigger
  "actions-setup-node versions.yml https://raw.githubusercontent.com/actions/setup-node/v4/.github/workflows/versions.yml"
  # tj-actions/changed-files — workflow_call (reusable workflow)
  "tj-actions-changed-files reusable.yml https://raw.githubusercontent.com/tj-actions/changed-files/main/.github/workflows/reusable-checks.yml"
  # cli/gh — workflow_dispatch with inputs, schedule
  "cli-gh deployment.yml https://raw.githubusercontent.com/cli/cli/trunk/.github/workflows/deployment.yml"
  # vercel/next.js — large multi-job CI with reusable workflow calls
  "nextjs build_and_test.yml https://raw.githubusercontent.com/vercel/next.js/canary/.github/workflows/build_and_test.yml"
  # vitejs/vite — JS tooling, matrix, env vars
  "vite ci.yml https://raw.githubusercontent.com/vitejs/vite/main/.github/workflows/ci.yml"
  # facebook/react — release flow with environment + permissions
  "react runtime_release.yml https://raw.githubusercontent.com/facebook/react/main/.github/workflows/runtime_publish_prerelease.yml"
  # oven-sh/bun — small focused workflow
  "bun format.yml https://raw.githubusercontent.com/oven-sh/bun/main/.github/workflows/format.yml"
  # denoland/deno — heavy permissions usage, custom container
  "deno ci.yml https://raw.githubusercontent.com/denoland/deno/main/.github/workflows/ci.yml"
  # microsoft/vscode — enterprise scale with secrets and concurrency
  "vscode pr-chat.yml https://raw.githubusercontent.com/microsoft/vscode/main/.github/workflows/pr-chat.yml"
  # tiangolo/fastapi — Python testing with Codecov
  "fastapi test.yml https://raw.githubusercontent.com/fastapi/fastapi/master/.github/workflows/test.yml"
  # rust-lang/cargo — Rust tooling, complex matrix
  "rust-cargo main.yml https://raw.githubusercontent.com/rust-lang/cargo/master/.github/workflows/main.yml"
  # actions/runner-images — workflow_dispatch with environment input
  "runner-images stale.yml https://raw.githubusercontent.com/actions/runner-images/main/.github/workflows/stale.yml"
)

for entry in "${FIXTURES[@]}"; do
  read -r subdir name url <<< "$entry"
  dest="$OUT/$subdir/$name"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]]; then
    echo "  • $dest already present, skipping"
    continue
  fi
  echo "  ↓ $url"
  if ! curl -fsSL --max-time 15 -o "$dest.tmp" "$url"; then
    echo "    ✗ failed; removing stub"
    rm -f "$dest.tmp"
    continue
  fi
  mv "$dest.tmp" "$dest"
done

count=$(find "$OUT" -name "*.yml" -o -name "*.yaml" | wc -l | tr -d ' ')
echo
echo "Fixture corpus: $count files in $OUT/"
