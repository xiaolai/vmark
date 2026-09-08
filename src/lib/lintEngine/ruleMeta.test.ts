// @vitest-environment node
/**
 * WI-FL0.3 — RULE_META is the ONE declaration of every rule's severity, and
 * every emitter reads it from there.
 *
 * `ruleMeta.ts` is what the docs gate joins against. Until audit 20260907
 * (#405) each rule module redeclared `ruleId` and `severity` inline where it
 * called `createDiagnostic`, and this file compared the two declarations by
 * scanning the emitters as source — two sources of truth held together by a
 * regex. The emitters now spread `ruleEmission("<ID>")`, so the severity a
 * rule ships IS the severity the docs are checked against; what this file
 * asserts is that no emitter has gone back to a literal, that every emitted id
 * has a RULE_META row and vice versa (a new rule cannot land undocumented —
 * the doc join requires a row per RULE_META entry), and that `ruleEmission`
 * hands out the row's severity.
 *
 * @coordinates-with src/lib/lintEngine/ruleMeta.ts — the subject
 * @coordinates-with src/lib/lintEngine/rules/allRules.ts — the registered rule list
 * @coordinates-with scripts/lib/docJoins/lintTable.mjs — joins website/guide/lint.md to RULE_META
 * @coordinates-with src/locales/en/editor.json — the `lint.rule.<id>` titles the UI renders
 * @module lib/lintEngine/ruleMeta.test
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULE_META, ruleEmission, ruleTitle, type RuleId, type RuleMeta } from "./ruleMeta";

const RULES_DIR = new URL("./rules/", import.meta.url);
const ALL_RULES_SRC = readFileSync(new URL("./rules/allRules.ts", import.meta.url), "utf8");
const YAML_SRC = readFileSync(new URL("./yaml.ts", import.meta.url), "utf8");
const LINK_CHECK_SRC = readFileSync(new URL("../markdownLinkCheck/check.ts", import.meta.url), "utf8");
/** The bundle the diagnostics pill reads its localized rule titles from. */
const EN_EDITOR = JSON.parse(
  readFileSync(new URL("../../locales/en/editor.json", import.meta.url), "utf8")
) as Record<string, string>;
const RULE_TITLE_PREFIX = "lint.rule.";

/** One `ruleEmission("<ID>")` reference found in an emitter. */
interface Emission {
  id: string;
  where: string;
}

/** Rule modules `allRules.ts` registers, by file stem (`./noReversedLink` → `noReversedLink`). */
const REGISTERED_RULE_MODULES = [...ALL_RULES_SRC.matchAll(/^import \{ \w+ \} from "\.\/(\w+)";$/gm)].map(
  (m) => m[1]
);

const RULE_MODULE_FILES = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Every rule id literal passed to `ruleEmission` in a source file, with its location. */
function emissionsIn(src: string, where: string): Emission[] {
  return [...src.matchAll(/\bruleEmission\(([^)]*)\)/g)].flatMap((m) =>
    [...m[1].matchAll(/"([A-Z]\d{2,3})"/g)].map((id) => ({ id: id[1], where }))
  );
}

function emissionsFromRuleModules(): Emission[] {
  return RULE_MODULE_FILES.flatMap((file) =>
    emissionsIn(readFileSync(new URL(file, RULES_DIR), "utf8"), `rules/${file}`)
  );
}

const byId = new Map<string, RuleMeta>(RULE_META.map((m) => [m.id, m]));

describe("RULE_META shape", () => {
  it("has unique, well-formed ids", () => {
    const ids = RULE_META.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(?:[EW]\d{2}|[MY]\d{3})$/);
  });

  it("every row carries a closed-set severity and a title with no trailing period", () => {
    for (const m of RULE_META) {
      expect(["error", "warning"], m.id).toContain(m.severity);
      expect(m.title.trim(), m.id).toBe(m.title);
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.title, m.id).not.toMatch(/\.$/);
    }
  });
});

describe("ruleEmission — the pair every emitter spreads into createDiagnostic", () => {
  it("returns the id and the RULE_META severity for every declared rule", () => {
    for (const m of RULE_META) {
      expect(ruleEmission(m.id as RuleId), m.id).toEqual({ ruleId: m.id, severity: m.severity });
    }
  });

  it("E05 is a warning in code, not the Error the doc used to claim", () => {
    expect(ruleEmission("E05").severity).toBe("warning");
  });
});

describe("every emitter reads its severity from RULE_META (#405)", () => {
  const fromRules = emissionsFromRuleModules();

  it("the rule-module scan is alive: every registered rule module emits through ruleEmission", () => {
    expect(REGISTERED_RULE_MODULES.length).toBeGreaterThanOrEqual(13);
    for (const stem of REGISTERED_RULE_MODULES) {
      expect(
        fromRules.some((e) => e.where === `rules/${stem}.ts`),
        `${stem}.ts registers in allRules.ts but no \`ruleEmission("…")\` call was found in it`
      ).toBe(true);
    }
  });

  it("no rule module declares a severity literal of its own any more", () => {
    for (const file of RULE_MODULE_FILES) {
      const src = readFileSync(new URL(file, RULES_DIR), "utf8");
      expect(src, `rules/${file} redeclares a severity — read it from RULE_META via ruleEmission`).not.toMatch(
        /\bseverity:\s*"(?:error|warning)"/
      );
      expect(src, `rules/${file} names a rule id outside ruleEmission`).not.toMatch(/\bruleId:\s*"/);
    }
  });

  it("yaml.ts emits Y001 and Y002 through ruleEmission, with no severity literal", () => {
    expect(emissionsIn(YAML_SRC, "yaml.ts").map((e) => e.id).sort()).toEqual(["Y001", "Y002"]);
    expect(YAML_SRC).not.toMatch(/\bseverity:\s*(?:cd\.severity === "error" \? )?"(?:error|warning)"/);
    // Y001 is the error branch and Y002 the warning branch, as the docs say.
    expect(YAML_SRC).toMatch(/ruleEmission\(cd\.severity === "error" \? "Y001" : "Y002"\)/);
    expect(ruleEmission("Y001").severity).toBe("error");
    expect(ruleEmission("Y002").severity).toBe("warning");
  });

  it("markdownLinkCheck/check.ts emits M001 (image) and M002 (link) through ruleEmission", () => {
    expect(emissionsIn(LINK_CHECK_SRC, "check.ts").map((e) => e.id).sort()).toEqual(["M001", "M002"]);
    expect(LINK_CHECK_SRC).toMatch(/ruleEmission\(r\.kind === "image" \? "M001" : "M002"\)/);
    expect(LINK_CHECK_SRC).not.toMatch(/\bseverity:\s*"(?:error|warning)"/);
  });

  it("the emitted id set equals the RULE_META id set — a new rule cannot ship undocumented", () => {
    const emitted = new Set(
      [...fromRules, ...emissionsIn(YAML_SRC, "yaml.ts"), ...emissionsIn(LINK_CHECK_SRC, "check.ts")].map(
        (e) => e.id
      )
    );
    expect([...emitted].sort()).toEqual([...byId.keys()].sort());
  });
});

describe("the scrambled rows this WI fixed stay joined to their emitters", () => {
  // The doc had E06 as the unclosed fence, E08 as the empty href and W05 as
  // the empty link text. The title is pinned to the MODULE that emits the id,
  // so the three cannot rotate again without one of these failing.
  it.each([
    ["E06", "noEmptyLinkText", /link text/i],
    ["E08", "unclosedFencedCode", /fenced code/i],
    ["W05", "noEmptyLinkHref", /href/i],
  ])("%s is emitted by %s and titled accordingly", (id, stem, title) => {
    const e = emissionsFromRuleModules().find((x) => x.id === id);
    expect(e?.where).toBe(`rules/${stem}.ts`);
    expect(byId.get(id)?.title).toMatch(title);
  });
});

// Audit 20260907 (#406): the diagnostics pill renders `t("lint.rule.<id>")`
// with the English title below as `defaultValue`. A rule with no key is not
// BROKEN — it degrades to that title — which is precisely why one could ship
// untranslated in nine locales and look green. Both directions are pinned: the
// English bundle must carry the canonical title for every rule (so English and
// the docs table cannot drift apart through the bundle), and it must carry no
// `lint.rule.*` key for an id this engine does not declare. The generic i18n
// gate then propagates the requirement to every other locale.
describe("lint.rule.<id> titles — one per rule, and no more", () => {
  it("the English bundle declares each rule's canonical title", () => {
    for (const m of RULE_META) expect(EN_EDITOR[`lint.rule.${m.id}`], m.id).toBe(m.title);
  });

  it("declares no lint.rule key for an id the engine does not emit", () => {
    const declared = new Set(RULE_META.map((m) => m.id));
    const orphans = Object.keys(EN_EDITOR)
      .filter((k) => k.startsWith(RULE_TITLE_PREFIX))
      .map((k) => k.slice(RULE_TITLE_PREFIX.length))
      .filter((id) => !declared.has(id));
    expect(orphans).toEqual([]);
  });
});

describe("ruleTitle — the English title the diagnostics UI translates over", () => {
  it("returns the documented title for every declared id", () => {
    for (const m of RULE_META) expect(ruleTitle(m.id), m.id).toBe(m.title);
  });

  it("returns undefined for an id the engine does not declare, so callers degrade to the bare id", () => {
    expect(ruleTitle("json/syntax")).toBeUndefined();
    expect(ruleTitle("E99")).toBeUndefined();
    expect(ruleTitle("")).toBeUndefined();
  });

  it("is an exact match — ids are case-sensitive identifiers", () => {
    expect(ruleTitle("e05")).toBeUndefined();
  });
});

// Audit 20260907 (#407): `readonly RuleMeta[]` guards the array at compile time
// only; the exported rows and the `BY_ID` index share references, so a caller
// could still rewrite a title or a severity for everyone. The data is frozen.
describe("RULE_META is immutable at runtime", () => {
  it("the list and every row are frozen", () => {
    expect(Object.isFrozen(RULE_META)).toBe(true);
    for (const m of RULE_META) expect(Object.isFrozen(m), m.id).toBe(true);
  });

  it("a write to a row neither succeeds nor reaches ruleTitle", () => {
    const row = RULE_META[0] as { title: string };
    expect(() => {
      "use strict";
      row.title = "tampered";
    }).toThrow(TypeError);
    expect(ruleTitle(RULE_META[0].id)).not.toBe("tampered");
  });

  it("ruleEmission hands out a fresh pair, so a caller cannot rewrite the shared row through it", () => {
    const a = ruleEmission("E01");
    const b = ruleEmission("E01");
    expect(a).not.toBe(b);
    (a as { severity: string }).severity = "warning";
    expect(ruleEmission("E01").severity).toBe("error");
  });
});
