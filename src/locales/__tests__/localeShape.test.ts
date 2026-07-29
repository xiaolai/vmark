// Locale bundles must mirror the English bundle's SHAPE, not just its key set.
//
// English stores most keys as flat literals containing dots
// (`"terminal.maxSessions": "…"`) and some as nested objects. Several locale
// bundles had drifted into carrying BOTH forms of the same logical key. That is
// invisible to a key-presence gate — flattening `{terminal: {maxSessions}}` and
// a literal `"terminal.maxSessions"` produces the same key name — but it is not
// invisible at runtime: i18next resolves the NESTED form first, so a
// translation written to the flat key is dead and the user still sees English.
//
// 747 such duplicated keys existed across 7 namespaces; 14 of them were
// actively hiding a translation. These assertions are what stop the shape from
// drifting apart again.
import { describe, it, expect } from "vitest";
import i18next from "i18next";

type Json = Record<string, unknown>;

const modules = import.meta.glob<Json>("../*/*.json", { eager: true, import: "default" });

/** locale -> namespace -> parsed bundle */
const BUNDLES: Record<string, Record<string, Json>> = {};
for (const [path, bundle] of Object.entries(modules)) {
  const m = /\.\.\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const [, locale, ns] = m;
  if (locale === "__tests__") continue;
  (BUNDLES[locale] ??= {})[ns] = bundle;
}

/** Flattened key -> every real path it occupies in this bundle. */
function pathsByKey(obj: Json): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const walk = (node: Json, prefix: string, path: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      const here = [...path, k];
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        walk(v as Json, key, here);
      } else {
        const list = out.get(key) ?? [];
        list.push(here);
        out.set(key, list);
      }
    }
  };
  walk(obj, "", []);
  return out;
}

const LOCALES = Object.keys(BUNDLES)
  .filter((l) => l !== "en")
  .sort();

describe("locale bundle shape", () => {
  it("discovers the locale bundles it is meant to guard", () => {
    // Guard against the glob silently matching nothing and every assertion
    // below passing vacuously.
    expect(LOCALES.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(BUNDLES.en ?? {}).length).toBeGreaterThan(5);
  });

  it("never stores one logical key at two different paths", () => {
    const shadowed: string[] = [];
    for (const locale of ["en", ...LOCALES]) {
      for (const [ns, bundle] of Object.entries(BUNDLES[locale] ?? {})) {
        for (const [key, paths] of pathsByKey(bundle)) {
          if (paths.length > 1) {
            shadowed.push(
              `${locale}/${ns}.json: ${key} at ${paths.map((p) => p.join("→")).join(" and ")}`,
            );
          }
        }
      }
    }
    expect(shadowed).toEqual([]);
  });

  it("stores every key as a flat literal, with no nested objects anywhere", () => {
    // Flat is the documented convention (AGENTS.md: "keys use flat
    // dot-separated camelCase") and it is what kills the shadowing bug class
    // outright rather than merely detecting it: i18next's nested branch cannot
    // match a bundle that contains no objects, so a flat key can never be
    // shadowed again. Converging the other way would not have this property —
    // a flat key added later would still be shadowed by its nested twin.
    const nested: string[] = [];
    for (const locale of ["en", ...LOCALES]) {
      for (const [ns, bundle] of Object.entries(BUNDLES[locale] ?? {})) {
        for (const [key, paths] of pathsByKey(bundle)) {
          if (paths[0].length > 1) {
            nested.push(`${locale}/${ns}.json: ${key} nested as ${paths[0].join("→")}`);
          }
        }
      }
    }
    expect(nested).toEqual([]);
  });

  it("stores every key at the same path English uses", () => {
    const drift: string[] = [];
    for (const [ns, en] of Object.entries(BUNDLES.en ?? {})) {
      const enPaths = pathsByKey(en);
      for (const locale of LOCALES) {
        const bundle = BUNDLES[locale]?.[ns];
        if (!bundle) continue;
        for (const [key, paths] of pathsByKey(bundle)) {
          const expected = enPaths.get(key);
          if (!expected) {
            drift.push(`${locale}/${ns}.json: ${key} — not in English`);
          } else if (paths[0].join(".") !== expected[0].join(".")) {
            drift.push(
              `${locale}/${ns}.json: ${key} at ${paths[0].join("→")}, English uses ${expected[0].join("→")}`,
            );
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });
});

// Why the shape matters. These two assertions are the observed i18next
// behaviour the rules above exist to protect; if a future i18next version
// changes either one, this is where it surfaces.
describe("i18next key resolution (the reason shape parity matters)", () => {
  async function resolve(resources: Json): Promise<string> {
    const inst = i18next.createInstance();
    await inst.init({ lng: "xx", resources: { xx: { ns: resources } } });
    return inst.t("ns:terminal.maxSessions");
  }

  it("resolves a flat literal key that contains the separator", async () => {
    // This is what English relies on for 1,535 of its keys, and what the
    // normalized locale bundles now rely on too.
    expect(await resolve({ "terminal.maxSessions": "FLAT" })).toBe("FLAT");
  });

  it("resolves the NESTED form first when both exist", async () => {
    // The trap: writing a translation to the flat key while a nested copy
    // holds English leaves the translation dead.
    expect(
      await resolve({
        "terminal.maxSessions": "FLAT",
        terminal: { maxSessions: "NESTED" },
      }),
    ).toBe("NESTED");
  });
});
