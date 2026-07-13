// Site plugin registry — dispatches on origin (ADR-S1). Mirrors the format registry.
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-3.1
import { beforeEach, describe, expect, it } from "vitest";
import type { SiteManifest } from "./types";
import {
  registerSite,
  dispatchSite,
  getSiteById,
  listSites,
  __resetSiteRegistry,
} from "./registry";

const zhihu: SiteManifest = {
  id: "zhihu",
  nameI18nKey: "sites.zhihu.name",
  origins: ["https://zhihu.com", "https://*.zhihu.com"],
  capabilities: ["read", "publish"],
  minAgentApi: 1,
};

beforeEach(() => __resetSiteRegistry());

describe("registerSite validation", () => {
  it("registers a valid manifest", () => {
    registerSite(zhihu);
    expect(getSiteById("zhihu")).toEqual(zhihu);
    expect(listSites()).toHaveLength(1);
  });

  it.each([
    ["Zhihu", "uppercase id"],
    ["zh_hu", "underscore"],
    ["zh hu", "space"],
    ["", "empty id"],
  ])("rejects invalid id %s (%s)", (id) => {
    expect(() => registerSite({ ...zhihu, id })).toThrow();
  });

  it("rejects an empty origins list", () => {
    expect(() => registerSite({ ...zhihu, origins: [] })).toThrow();
  });

  it("rejects an un-canonicalizable origin pattern", () => {
    expect(() => registerSite({ ...zhihu, origins: ["not-a-url"] })).toThrow();
    expect(() => registerSite({ ...zhihu, origins: ["about:blank"] })).toThrow();
    expect(() => registerSite({ ...zhihu, origins: ["https://*"] })).toThrow();
  });

  it("rejects an empty capabilities list", () => {
    expect(() => registerSite({ ...zhihu, capabilities: [] })).toThrow();
  });

  it("rejects a plugin requiring a newer agent API than the host provides", () => {
    expect(() => registerSite({ ...zhihu, minAgentApi: 999 })).toThrow();
  });

  it("rejects a duplicate id", () => {
    registerSite(zhihu);
    expect(() => registerSite(zhihu)).toThrow();
  });

  it("rejects an exact-origin collision across plugins", () => {
    registerSite(zhihu);
    const clash: SiteManifest = { ...zhihu, id: "zhihu-clone", origins: ["https://zhihu.com"] };
    expect(() => registerSite(clash)).toThrow();
  });

  it("rejects duplicate exact origins WITHIN one manifest", () => {
    expect(() =>
      registerSite({ ...zhihu, origins: ["https://a.com", "https://a.com"] }),
    ).toThrow();
  });

  it("rejects duplicate WILDCARD origins within one manifest", () => {
    expect(() =>
      registerSite({ ...zhihu, origins: ["https://*.a.com", "https://*.a.com"] }),
    ).toThrow();
  });

  it("rejects canonically-equivalent duplicate origins (case / trailing slash / default port)", () => {
    expect(() =>
      registerSite({ ...zhihu, origins: ["https://a.com", "https://A.com/"] }),
    ).toThrow();
    expect(() =>
      registerSite({ ...zhihu, origins: ["https://a.com", "https://a.com:443"] }),
    ).toThrow();
  });

  it("rejects a non-string id from a malformed runtime manifest", () => {
    expect(() => registerSite({ ...zhihu, id: 123 as unknown as string })).toThrow();
    expect(getSiteById(123 as unknown as string)).toBeUndefined();
  });

  it("rejects a non-string nameI18nKey / origin pattern from a malformed runtime manifest", () => {
    expect(() =>
      registerSite({ ...zhihu, nameI18nKey: 7 as unknown as string }),
    ).toThrow();
    expect(() => registerSite({ ...zhihu, origins: [7 as unknown as string] })).toThrow();
  });

  it("rejects non-array origins / capabilities from a malformed runtime manifest", () => {
    expect(() =>
      registerSite({ ...zhihu, origins: "https://a.com" as unknown as string[] }),
    ).toThrow();
    expect(() =>
      registerSite({ ...zhihu, capabilities: "read" as unknown as SiteManifest["capabilities"] }),
    ).toThrow();
  });

  it("SECURITY: commits the manifest snapshot it validated (a getter cannot swap origins mid-registration)", () => {
    const reads = [["https://a.example"], ["https://b.example"], ["https://c.example"]];
    let i = 0;
    const sneaky = {
      id: "sneaky",
      nameI18nKey: "sites.sneaky.name",
      capabilities: ["read"],
      minAgentApi: 1,
      get origins() {
        return reads[Math.min(i++, reads.length - 1)];
      },
    } as unknown as SiteManifest;

    registerSite(sneaky);
    // Whatever was validated is what got committed — only ONE read of the field.
    expect(getSiteById("sneaky")?.origins).toEqual(["https://a.example"]);
    expect(dispatchSite("https://a.example")?.id).toBe("sneaky");
    expect(dispatchSite("https://b.example")).toBeNull();
    expect(dispatchSite("https://c.example")).toBeNull();
  });

  it("rejects an unknown or duplicated capability value", () => {
    // @ts-expect-error — exercising runtime validation of a bad capability
    expect(() => registerSite({ ...zhihu, capabilities: ["read", "delete"] })).toThrow();
    expect(() => registerSite({ ...zhihu, capabilities: ["read", "read"] })).toThrow();
  });

  it("rejects an empty nameI18nKey", () => {
    expect(() => registerSite({ ...zhihu, nameI18nKey: "" })).toThrow();
  });

  it.each([
    [1.5, "fractional"],
    [-1, "negative"],
    [Number.NaN, "NaN"],
  ])("rejects a non-integer/negative minAgentApi (%s, %s)", (minAgentApi) => {
    expect(() => registerSite({ ...zhihu, minAgentApi })).toThrow();
  });

  it("SECURITY: mutating the array returned by listSites does not change the registry", () => {
    registerSite(zhihu);
    const snapshot = listSites() as SiteManifest[];
    expect(() => snapshot.push({ ...zhihu, id: "injected" })).toThrow(); // frozen snapshot
    expect(getSiteById("injected")).toBeUndefined();
    expect(listSites()).toHaveLength(1);
  });

  it("SECURITY: mutating a manifest's origins after registration does not change dispatch", () => {
    const m: SiteManifest = {
      id: "frozen",
      nameI18nKey: "sites.frozen.name",
      origins: ["https://frozen.com"],
      capabilities: ["read"],
      minAgentApi: 1,
    };
    registerSite(m);
    // Attempt to widen the grant after the fact (cast past `readonly` — the type
    // contract forbids this, but a runtime caller can still try).
    try {
      (m.origins as string[]).push("https://evil.com");
    } catch {
      /* frozen input throws in strict mode — also acceptable */
    }
    expect(dispatchSite("https://evil.com")).toBeNull();
  });
});

describe("dispatchSite", () => {
  it("returns null when no plugin matches", () => {
    registerSite(zhihu);
    expect(dispatchSite("https://weibo.com")).toBeNull();
  });

  it("returns null for an un-navigable URL", () => {
    registerSite(zhihu);
    expect(dispatchSite("about:blank")).toBeNull();
  });

  it("matches an exact origin", () => {
    registerSite(zhihu);
    expect(dispatchSite("https://zhihu.com/question/1")?.id).toBe("zhihu");
  });

  it("matches a subdomain via wildcard", () => {
    registerSite(zhihu);
    expect(dispatchSite("https://zhuanlan.zhihu.com/p/1")?.id).toBe("zhihu");
  });

  it("prefers an exact-origin plugin over a wildcard plugin (precedence)", () => {
    const wildcardOwner: SiteManifest = {
      id: "zhihu-wild",
      nameI18nKey: "sites.zhihuWild.name",
      origins: ["https://*.zhihu.com"],
      capabilities: ["read"],
      minAgentApi: 1,
    };
    const exactOwner: SiteManifest = {
      id: "zhihu-column",
      nameI18nKey: "sites.zhihuColumn.name",
      origins: ["https://zhuanlan.zhihu.com"],
      capabilities: ["read", "publish"],
      minAgentApi: 1,
    };
    registerSite(wildcardOwner);
    registerSite(exactOwner);
    // zhuanlan.zhihu.com is claimed exactly by one and by-wildcard by the other.
    expect(dispatchSite("https://zhuanlan.zhihu.com/p/1")?.id).toBe("zhihu-column");
    // A different subdomain still resolves to the wildcard owner.
    expect(dispatchSite("https://www.zhihu.com/x")?.id).toBe("zhihu-wild");
  });

  it("prefers the MORE SPECIFIC wildcard when two wildcards match (not registration order)", () => {
    const broad: SiteManifest = {
      id: "broad",
      nameI18nKey: "sites.broad.name",
      origins: ["https://*.example.com"],
      capabilities: ["read"],
      minAgentApi: 1,
    };
    const narrow: SiteManifest = {
      id: "narrow",
      nameI18nKey: "sites.narrow.name",
      origins: ["https://*.sub.example.com"],
      capabilities: ["read"],
      minAgentApi: 1,
    };
    // Register broad FIRST so registration order would pick the wrong one.
    registerSite(broad);
    registerSite(narrow);
    expect(dispatchSite("https://x.sub.example.com/p")?.id).toBe("narrow");
    // A host only the broad pattern covers still resolves to broad.
    expect(dispatchSite("https://other.example.com/p")?.id).toBe("broad");
  });
});
