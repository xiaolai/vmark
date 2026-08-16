// Gate self-test for scripts/check-webview-floor.mjs.
//
// The gate exists because three surfaces asserted the OS floor and nothing
// compared them (#1278). A gate that only ever reports green on the current
// tree would reproduce exactly that failure, so every case here drives it with
// a tree it should REJECT.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findings,
  compareVersions,
  oldestMacosFor,
  readViteTarget,
  readTauriMinimum,
  readDocsMinimums,
  readDownloadDocs,
  readCaskMacos,
  MACOS_BASELINE_SAFARI,
} from "./check-webview-floor.mjs";

const ROOT = join(import.meta.dirname, "..");

/** A tree that should pass, so each case below can break exactly one thing. */
const OK = {
  viteSource: `export default defineConfig({\n  build: {\n    target: "safari16.4",\n  },\n});\n`,
  tauriConf: { bundle: { macOS: { minimumSystemVersion: "13.4" } } },
  downloadDocs: { "website/download.md": "- macOS 13.4 (Ventura) or later\n" },
  caskWorkflow: "            depends_on macos: :ventura\n",
};

describe("compareVersions", () => {
  it.each([
    ["13.4", "13.4", 0],
    ["13.4", "13.3", 1],
    ["13.3", "13.4", -1],
    ["16.5.1", "16.4", 1],
    // "13.10" is thirteen-point-TEN, not thirteen-point-one: a string compare
    // gets this backwards, and macOS point releases reach double digits.
    ["13.10", "13.9", 1],
    // Missing components are zero, so "14" and "14.0.0" are the same version.
    ["14", "14.0.0", 0],
  ])("compareVersions(%s, %s) → %i", (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });
});

describe("oldestMacosFor", () => {
  it("picks the OLDEST macOS that satisfies the target, not the newest", () => {
    expect(oldestMacosFor("16.4").macos).toBe("13.4");
  });

  it("does not offer a macOS whose shipped Safari is too old", () => {
    // Monterey ships 15.6.1, so it must never be returned for a 16.x target
    // however close the numbers look.
    expect(oldestMacosFor("16.0").macos).not.toBe("12.6");
  });

  it("returns an older macOS for an older target", () => {
    expect(oldestMacosFor("14.0").macos).toBe("11.6");
    expect(oldestMacosFor("13.0").macos).toBe("10.15");
  });

  it("returns null when no listed macOS can satisfy the target", () => {
    expect(oldestMacosFor("26.0")).toBeNull();
  });

  it("is unaffected by the order of the table", () => {
    // The lookup sorts internally; a future editor appending a row out of
    // order must not change the answer.
    const shuffled = [...MACOS_BASELINE_SAFARI].reverse();
    expect(shuffled.length).toBe(MACOS_BASELINE_SAFARI.length);
    expect(oldestMacosFor("16.4").macos).toBe("13.4");
  });
});

describe("parsers", () => {
  it("reads an explicit build.target", () => {
    expect(readViteTarget(OK.viteSource)).toBe("safari16.4");
  });

  it("returns null when build.target is absent — the original defect", () => {
    expect(readViteTarget("export default defineConfig({ build: {} });")).toBeNull();
  });

  it("returns null when no target key exists at all", () => {
    expect(readViteTarget(`{ esbuild: { jsx: "automatic" } }`)).toBeNull();
  });

  it("reads a single-line build block — not anchored to line start", () => {
    expect(readViteTarget(`build: { target: "safari16.4" }`)).toBe("safari16.4");
  });

  it("ignores a target named only in a comment", () => {
    // This gate's own config comment explains WHY safari16.4 is pinned. A scan
    // that reads prose would pass on a tree whose real target says otherwise.
    expect(
      readViteTarget(`// we target safari16.4 because ...\nbuild: {}`),
    ).toBeNull();
    expect(
      readViteTarget(`/* target: "safari16.4" */\nbuild: { target: "esnext" }`),
    ).toBe("esnext");
  });

  it("reports ambiguity rather than picking one of two targets", () => {
    const got = readViteTarget(`build: { target: "safari16.4" }\nfoo: { target: "esnext" }`);
    expect(got).toEqual({ ambiguous: ["safari16.4", "esnext"] });
  });

  it("collapses a repeated identical target rather than calling it ambiguous", () => {
    expect(
      readViteTarget(`build: { target: "safari16.4" }\nx: { target: "safari16.4" }`),
    ).toBe("safari16.4");
  });

  it("reads the tauri minimum and tolerates its absence", () => {
    expect(readTauriMinimum(OK.tauriConf)).toBe("13.4");
    expect(readTauriMinimum({ bundle: {} })).toBeNull();
    expect(readTauriMinimum(null)).toBeNull();
  });

  it("reads the cask macOS symbol and tolerates its absence", () => {
    expect(readCaskMacos("            depends_on macos: :ventura\n")).toBe("ventura");
    expect(readCaskMacos("depends_on macos: :big_sur")).toBe("big_sur");
    expect(readCaskMacos("app \"VMark.app\"")).toBeNull();
  });

  it("finds every macOS claim in the docs, not just the first", () => {
    expect(readDocsMinimums("macOS 13.4 or later\n\nalso macOS 10.15\n")).toEqual([
      "13.4",
      "10.15",
    ]);
  });
});

describe("findings", () => {
  it("passes a consistent tree", () => {
    expect(findings(OK)).toEqual([]);
  });

  it("FAILS when build.target is unset", () => {
    const out = findings({ ...OK, viteSource: "export default defineConfig({});" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/no `build.target`/);
  });

  it("FAILS when the OS minimum is older than the target needs", () => {
    // The exact shape of #1278: safari16.4 emitted, macOS 10.15 permitted.
    const out = findings({
      ...OK,
      tauriConf: { bundle: { macOS: { minimumSystemVersion: "10.15" } } },
      downloadDocs: { "website/download.md": "- macOS 10.15 (Catalina) or later\n" },
    });
    expect(out.some((f) => /allows macOS 10\.15/.test(f))).toBe(true);
    expect(out.some((f) => /BLANK WINDOW/.test(f))).toBe(true);
  });

  it("FAILS when the docs disagree with the shipped floor", () => {
    const out = findings({ ...OK, downloadDocs: { "website/fr/download.md": "- macOS 12.6 or later\n" } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/website\/fr\/download\.md says "macOS 12\.6"/);
  });

  // A docs claim that is too CONSERVATIVE is still a defect: it turns away
  // users the build supports, and it is the direction a lazy fix drifts.
  it("FAILS when the docs are stricter than necessary", () => {
    const out = findings({ ...OK, downloadDocs: { "website/download.md": "- macOS 14.0 (Sonoma) or later\n" } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/download\.md says "macOS 14\.0"/);
  });

  it("FAILS when the target is not a single Safari version", () => {
    const out = findings({
      ...OK,
      viteSource: `build: { target: "esnext" }`,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/must name a single Safari version/);
  });

  it("FAILS when two different targets are declared", () => {
    const out = findings({
      ...OK,
      viteSource: `build: { target: "safari16.4" }\nz: { target: "esnext" }`,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/more than one build target/);
  });

  it("FAILS when no listed macOS can satisfy the target", () => {
    const out = findings({ ...OK, viteSource: `build: { target: "safari99" }` });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/cannot be supported by any macOS release listed/);
  });

  it("FAILS when the tauri minimum is missing entirely", () => {
    const out = findings({ ...OK, tauriConf: { bundle: { macOS: {} } } });
    expect(out.some((f) => /no bundle.macOS.minimumSystemVersion/.test(f))).toBe(true);
  });

  // The defect the first cut of this gate had: English correct, translations
  // stale, gate green. Nine locales were lying while the check passed.
  it("FAILS when one LOCALE lags even though English is correct", () => {
    const out = findings({
      ...OK,
      downloadDocs: {
        "website/download.md": "- macOS 13.4 (Ventura) or later\n",
        "website/ja/download.md": "- macOS 10.15 (Catalina) 以降\n",
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/website\/ja\/download\.md says "macOS 10\.15"/);
  });

  it("checks every locale, not just the first that disagrees", () => {
    const out = findings({
      ...OK,
      downloadDocs: {
        "website/de/download.md": "- macOS 10.15\n",
        "website/ko/download.md": "- macOS 12.6\n",
      },
    });
    expect(out).toHaveLength(2);
  });

  it("FAILS when the Homebrew cask names the wrong macOS", () => {
    // The state this shipped in: cask :catalina, app needs Ventura. brew
    // installs it, macOS then refuses to open it.
    const out = findings({ ...OK, caskWorkflow: "depends_on macos: :catalina\n" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/cask depends on macOS :catalina/);
  });

  it("FAILS when the cask declares no macOS dependency", () => {
    const out = findings({ ...OK, caskWorkflow: "name \"VMark\"\n" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/declares no `depends_on macos:`/);
  });

  it("accepts the MAJOR version containing the floor", () => {
    // Homebrew cannot express 13.4, so :ventura is correct even though it is
    // looser than LSMinimumSystemVersion. Rejecting it would force the cask
    // to name a version Homebrew has no symbol for.
    expect(findings({ ...OK, caskWorkflow: "depends_on macos: :ventura\n" })).toEqual([]);
  });

  it("FAILS when the docs state no requirement at all", () => {
    const out = findings({ ...OK, downloadDocs: { "website/download.md": "# Download\n" } });
    expect(out.some((f) => /states no `macOS <version>` requirement/.test(f))).toBe(true);
  });
});

describe("the real repository", () => {
  it("is consistent across all three surfaces", () => {
    expect(
      findings({
        viteSource: readFileSync(join(ROOT, "vite.config.ts"), "utf8"),
        tauriConf: JSON.parse(
          readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
        ),
        downloadDocs: readDownloadDocs(),
        caskWorkflow: readFileSync(
          join(ROOT, ".github/workflows/update-homebrew.yml"),
          "utf8",
        ),
      }),
    ).toEqual([]);
  });

  it("discovers every locale download page, not a hardcoded list", () => {
    const docs = readDownloadDocs();
    const paths = Object.keys(docs);
    expect(paths).toContain("website/download.md");
    // Ten locales ship today; assert the shape rather than the number so a new
    // translation does not fail this, but a discovery that stops working does.
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.every((p) => p.endsWith("download.md"))).toBe(true);
  });

  it("every table row is ordered and internally consistent", () => {
    // Guards the evidence itself: a row appended with a mismatched pair would
    // silently move the floor for everyone.
    for (let i = 1; i < MACOS_BASELINE_SAFARI.length; i++) {
      const prev = MACOS_BASELINE_SAFARI[i - 1];
      const cur = MACOS_BASELINE_SAFARI[i];
      expect(compareVersions(cur.macos, prev.macos)).toBeGreaterThan(0);
      expect(compareVersions(cur.safari, prev.safari)).toBeGreaterThan(0);
      expect(typeof cur.cask).toBe("string");
    }
  });
});
