/**
 * `latest.json` must name a bundle for every installer format the release
 * signs — not one bundle per OS.
 *
 * Tauri's updater does NOT look up a single `{os}-{arch}` key. It builds
 * `[{os}-{arch}-{installer}, {os}-{arch}]` and takes the FIRST that resolves
 * (tauri-plugin-updater `updater.rs`, `Updater::get_urls`), where `{installer}`
 * is one of `appimage|deb|rpm|app|msi|nsis`, read from a bundle-type marker
 * tauri-bundler patches into the binary at package time. Verified on the
 * shipped artifact: `VMark_0.9.81_amd64.deb` carries
 * `__TAURI_BUNDLE_TYPE_VAR_DEB`, so a .deb install asks for
 * `linux-x86_64-deb` before anything else.
 *
 * Publishing only the bare keys therefore served EVERY .deb and .rpm install
 * the 116MB AppImage (#1444) — and that download cannot install even when it
 * completes, because the Linux installer dispatches on the INSTALLED bundle
 * type: `install_deb()` sniffs the bytes with `infer::archive::is_deb` and
 * returns `InvalidUpdaterFormat`. The reporter's download failing at 24% only
 * truncated a transfer that was already doomed.
 *
 * The same defect had a SECOND instance that no user had reported yet:
 * `WINDOWS_EXE_SIG` was read from `*_x64-setup.exe.sig` and then never
 * referenced by the manifest, so every NSIS install — the channel
 * `release-smoke.yml` actually exercises — was served the MSI. Windows does
 * not hard-fail there (it sniffs the downloaded bytes and shells out to
 * msiexec), so it silently converted an NSIS install into an MSI one. One
 * defect, two instances; this pins the whole class.
 *
 * What is pinned: the manifest is DERIVED from a platform-key table rather
 * than hand-written, every installer format the build produces has a key, the
 * installer suffixes match the updater's vocabulary exactly (a typo like
 * `-debian` never matches and silently falls back), the bare fallback keys
 * survive for binaries with no marker, and the reverse-coverage check — every
 * signed bundle is reachable from some key — is still in place. That last one
 * is the assertion this bug earns: it is what would have failed on the Windows
 * instance the day it was introduced.
 *
 * @coordinates-with .github/workflows/release.yml
 * @module scripts/check-release-updater-targets.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = parseYaml(
  readFileSync(path.join(REPO, ".github/workflows/release.yml"), "utf8"),
);

/** The step that writes the updater manifest. */
const manifestStep = (workflow.jobs["publish-release"]?.steps ?? []).find((s) =>
  /latest\.json/.test(String(s.name ?? "")),
);
const run = String(manifestStep?.run ?? "");

/**
 * The platform-key table, read out of the workflow rather than restated here —
 * a copy would drift and still pass.
 */
function parseTargets(source) {
  const block = source.match(/TARGETS=\(\n([\s\S]*?)\n\s*\)/);
  if (!block) return null;
  return [...block[1].matchAll(/"([^"|]+)\|([^"]+)"/g)].map((m) => ({
    key: m[1],
    glob: m[2],
  }));
}

/**
 * Exactly the strings `Installer::name()` returns in tauri-plugin-updater.
 * The updater matches these literally; anything else never resolves.
 */
const INSTALLER_NAMES = ["appimage", "deb", "rpm", "app", "msi", "nsis"];

describe("release.yml updater manifest", () => {
  it("writes the manifest from a platform-key table, not a hand-written heredoc", () => {
    expect(manifestStep, "publish-release must have a latest.json step").toBeTruthy();
    expect(parseTargets(run), "expected a TARGETS=( \"key|glob\" ... ) table").not.toBeNull();
  });

  const targets = parseTargets(run) ?? [];
  const keys = targets.map((t) => t.key);

  it("covers every installer format the Linux build produces", () => {
    // tauri.conf.json sets `targets: all`, so the Linux leg emits all three and
    // signs all three. Each needs its own key or its users fall back to the
    // AppImage and get InvalidUpdaterFormat.
    expect(keys).toContain("linux-x86_64-deb");
    expect(keys).toContain("linux-x86_64-rpm");
    expect(keys).toContain("linux-x86_64-appimage");
  });

  it("covers both Windows installer formats", () => {
    expect(keys).toContain("windows-x86_64-nsis");
    expect(keys).toContain("windows-x86_64-msi");
  });

  it("keeps the bare {os}-{arch} fallback for binaries with no bundle marker", () => {
    // `bundle_type()` returns None when the marker is unpatched (a raw binary,
    // a tarball, a distro repackage). Those resolve ONLY the bare key.
    expect(keys).toContain("linux-x86_64");
    expect(keys).toContain("windows-x86_64");
    expect(keys).toContain("darwin-aarch64");
    expect(keys).toContain("darwin-x86_64");
  });

  it("points each Linux key at the matching bundle, not at another format", () => {
    const glob = (key) => targets.find((t) => t.key === key)?.glob ?? "";
    expect(glob("linux-x86_64-deb")).toMatch(/\.deb$/);
    expect(glob("linux-x86_64-rpm")).toMatch(/\.rpm$/);
    expect(glob("linux-x86_64-appimage")).toMatch(/\.AppImage$/);
    expect(glob("windows-x86_64-nsis")).toMatch(/-setup\.exe$/);
    expect(glob("windows-x86_64-msi")).toMatch(/\.msi$/);
  });

  it("uses only installer suffixes the updater actually matches", () => {
    // A key like `linux-x86_64-debian` parses, publishes, and never resolves —
    // it fails by silently falling back, which looks exactly like working.
    for (const key of keys) {
      const suffix = key.split("-").slice(2).join("-");
      if (suffix === "") continue; // bare {os}-{arch} fallback
      expect(INSTALLER_NAMES, `'${key}' has an unknown installer suffix`).toContain(suffix);
    }
  });

  it("names each key exactly once", () => {
    expect(keys).toStrictEqual([...new Set(keys)]);
  });

  it("fails the release when a signed bundle is unreachable from the manifest", () => {
    // The reverse direction, and the reason the Windows instance survived: a
    // signature can be produced, uploaded, and referenced by nothing. Deleting
    // this check restores that blind spot.
    expect(run).toMatch(/UNREFERENCED=/);
    expect(run).toMatch(/::error::.*not reachable from latest\.json/);
  });

  it("still refuses empty signatures and unexpanded variables", () => {
    // Pre-existing guards; the rewrite must not drop them.
    expect(run).toMatch(/EMPTY_SIG_PLATFORMS=/);
    expect(run).toMatch(/unexpanded shell variable/);
  });
});
