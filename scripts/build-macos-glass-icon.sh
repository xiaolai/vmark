#!/usr/bin/env bash
#
# Compile `src-tauri/icons/VMark.icon` into the `Assets.car` that macOS 26 needs
# in order to draw the Dock icon with the Liquid Glass treatment.
#
# Why this exists: a `.icns` is a bag of flat bitmaps. macOS 26 masks and lights
# it itself, and when the bitmap already carries its own rounded corners — as
# VMark's did until 0.9.62 — the system's edge highlight lands on our baked edge
# and shows as a thin pale seam along the lit sides (measured on the shipped icon:
# the first opaque pixels on the top and left edges were (162,189,228) against a
# (52,81,131) body). The glass — squircle mask, drop shadow, background gradient,
# per-layer specular — is applied at composite time only for a layered `.icon`
# document compiled into an asset catalogue, so the layers are drawn edge to
# edge and the system owns the shape. This is Paper's recipe (paper-one,
# dev-docs/icons.md), applied to VMark.
#
# The output is committed on purpose: compiling needs Xcode (`actool` is not in
# the Command Line Tools) and `cargo build` must not. Re-run this whenever
# `VMark.icon` changes, the same rule `icon.icns` and the PNG set follow.
#
# actool's failure modes (measured by Paper on Xcode 26.4.1): a bad enum, a
# missing asset or a malformed fill colour exit 1 with errors, which `set -e`
# catches. An UNKNOWN KEY exits 0 and writes a catalogue byte-identical to the
# correct one — no existence check can catch that; only rendering the compiled
# icon and inspecting pixels can (see `scripts/render-dock-icon.swift`).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
icon_src="$repo_root/src-tauri/icons/VMark.icon"
out_file="$repo_root/src-tauri/icons/Assets.car"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos-glass-icon: macOS only — nothing to do on $(uname -s)." >&2
  exit 0
fi

actool="$(xcrun --find actool 2>/dev/null || true)"
if [[ -z "$actool" ]]; then
  echo "build-macos-glass-icon: actool not found. Install Xcode 26 or newer" >&2
  echo "  (the Command Line Tools alone do not ship actool)." >&2
  exit 1
fi

[[ -f "$icon_src/icon.json" ]] || { echo "missing $icon_src/icon.json" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The input is the `.icon` itself, not a directory containing it and not an
# `.xcassets`: both are accepted and silently compile nothing.
# --minimum-deployment-target 26.0 selects the glass renderer;
# --output-partial-info-plist is mandatory even though the plist is discarded.
"$actool" "$icon_src" \
  --compile "$work" \
  --output-partial-info-plist "$work/partial.plist" \
  --app-icon VMark \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx \
  --output-format human-readable-text --notices --warnings --errors

if [[ ! -s "$work/Assets.car" ]]; then
  echo "build-macos-glass-icon: actool produced no Assets.car." >&2
  echo "  actool normally exits non-zero on bad input and set -e catches it first," >&2
  echo "  so reaching here means it exited 0 and still wrote nothing — an older or" >&2
  echo "  regressed toolchain. Check icon.json against the keys actool accepts and" >&2
  echo "  confirm every image-name resolves to a file in VMark.icon/Assets/." >&2
  exit 1
fi

# actool also emits a VMark.icns carrying only the 16pt and 128pt representations;
# the hand-built icons/icon.icns keeps the full ladder as the legacy fallback and
# is not touched here.
cp "$work/Assets.car" "$out_file"
echo "build-macos-glass-icon: wrote $out_file ($(wc -c <"$out_file" | tr -d ' ') bytes)"
