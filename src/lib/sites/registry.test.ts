// @vitest-environment node
// Site plugin registry — dispatches on origin (ADR-S1). Mirrors the format registry.
// Wiring plan: dev-docs/plans/20260819-browser-wire-and-borrows.md WI-NB4.2
import { beforeEach, describe, expect, it } from "vitest";
import type { SiteManifest } from "./types";
import type { SiteReader } from "@/lib/browser/reader/siteReader";
import {
  registerSite,
  dispatchSite,
  getSiteById,
  listSites,
  siteReaderById,
  readerForUrl,
  __resetSiteRegistry,
} from "./registry";

/** A minimal well-formed reader paired to a manifest under test. */
function stubReader(id: string): SiteReader {
  return {
    id,
    match: () => true,
    read: (html, url) => ({ title: "stub", byline: "", url, markdown: html.slice(0, 10), textLength: 0 }),
  };
}
/** Register with an auto-paired stub reader — the shape most tests need. */
const register = (m: SiteManifest): void => registerSite(m, stubReader(m.id));

const zhihu: SiteManifest = {
  id: "zhihu",
  nameI18nKey: "sites.zhihu.name",
  origins: ["https://zhihu.com", "https://*.zhihu.com"],
  capabilities: ["read"],
  minAgentApi: 1,
};

beforeEach(() => __resetSiteRegistry());

describe("registerSite validation", () => {
  it("registers a valid manifest", () => {
    register(zhihu);
    expect(getSiteById("zhihu")).toEqual(zhihu);
    expect(listSites()).toHaveLength(1);
  });

  it.each([
    ["Zhihu", "uppercase id"],
    ["zh_hu", "underscore"],
    ["zh hu", "space"],
    ["", "empty id"],
  ])("rejects invalid id %s (%s)", (id) => {
    expect(() => register({ ...zhihu, id })).toThrow();
  });

  it("rejects an empty origins list", () => {
    expect(() => register({ ...zhihu, origins: [] })).toThrow();
  });

  it("rejects an un-canonicalizable origin pattern", () => {
    expect(() => register({ ...zhihu, origins: ["not-a-url"] })).toThrow();
    expect(() => register({ ...zhihu, origins: ["about:blank"] })).toThrow();
    expect(() => register({ ...zhihu, origins: ["https://*"] })).toThrow();
  });

  it("rejects an empty capabilities list", () => {
    expect(() => register({ ...zhihu, capabilities: [] })).toThrow();
  });

  it("rejects a plugin requiring a newer agent API than the host provides", () => {
    expect(() => register({ ...zhihu, minAgentApi: 999 })).toThrow();
  });

  it("rejects a duplicate id", () => {
    register(zhihu);
    expect(() => register(zhihu)).toThrow();
  });

  it("rejects an exact-origin collision across plugins", () => {
    register(zhihu);
    const clash: SiteManifest = { ...zhihu, id: "zhihu-clone", origins: ["https://zhihu.com"] };
    expect(() => register(clash)).toThrow();
  });

  it("rejects duplicate exact origins WITHIN one manifest", () => {
    expect(() =>
      register({ ...zhihu, origins: ["https://a.com", "https://a.com"] }),
    ).toThrow();
  });

  it("rejects duplicate WILDCARD origins within one manifest", () => {
    expect(() =>
      register({ ...zhihu, origins: ["https://*.a.com", "https://*.a.com"] }),
    ).toThrow();
  });

  it("rejects a WILDCARD-origin collision ACROSS plugins (dispatch would be order-dependent)", () => {
    register({ ...zhihu, id: "first", origins: ["https://*.shared.com"] });
    expect(() =>
      register({ ...zhihu, id: "second", origins: ["https://*.shared.com"] }),
    ).toThrow();
  });

  it("rejects a canonically-equivalent wildcard collision across plugins (case)", () => {
    register({ ...zhihu, id: "first", origins: ["https://*.shared.com"] });
    expect(() =>
      register({ ...zhihu, id: "second", origins: ["https://*.SHARED.com"] }),
    ).toThrow();
  });

  it("rejects canonically-equivalent duplicate origins (case / trailing slash / default port)", () => {
    expect(() =>
      register({ ...zhihu, origins: ["https://a.com", "https://A.com/"] }),
    ).toThrow();
    expect(() =>
      register({ ...zhihu, origins: ["https://a.com", "https://a.com:443"] }),
    ).toThrow();
  });

  it("rejects a non-string id from a malformed runtime manifest", () => {
    expect(() => register({ ...zhihu, id: 123 as unknown as string })).toThrow();
    expect(getSiteById(123 as unknown as string)).toBeUndefined();
  });

  it("rejects a non-string nameI18nKey / origin pattern from a malformed runtime manifest", () => {
    expect(() =>
      register({ ...zhihu, nameI18nKey: 7 as unknown as string }),
    ).toThrow();
    expect(() => register({ ...zhihu, origins: [7 as unknown as string] })).toThrow();
  });

  it("rejects non-array origins / capabilities from a malformed runtime manifest", () => {
    expect(() =>
      register({ ...zhihu, origins: "https://a.com" as unknown as string[] }),
    ).toThrow();
    expect(() =>
      register({ ...zhihu, capabilities: "read" as unknown as SiteManifest["capabilities"] }),
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

    register(sneaky);
    // Whatever was validated is what got committed — only ONE read of the field.
    expect(getSiteById("sneaky")?.origins).toEqual(["https://a.example"]);
    expect(dispatchSite("https://a.example")?.id).toBe("sneaky");
    expect(dispatchSite("https://b.example")).toBeNull();
    expect(dispatchSite("https://c.example")).toBeNull();
  });

  it("rejects an unknown or duplicated capability value", () => {
    // @ts-expect-error — exercising runtime validation of a bad capability
    expect(() => register({ ...zhihu, capabilities: ["read", "delete"] })).toThrow();
    expect(() => register({ ...zhihu, capabilities: ["read", "read"] })).toThrow();
  });

  it("rejects an empty nameI18nKey", () => {
    expect(() => register({ ...zhihu, nameI18nKey: "" })).toThrow();
  });

  it.each([
    [1.5, "fractional"],
    [-1, "negative"],
    [Number.NaN, "NaN"],
  ])("rejects a non-integer/negative minAgentApi (%s, %s)", (minAgentApi) => {
    expect(() => register({ ...zhihu, minAgentApi })).toThrow();
  });

  it("SECURITY: mutating the array returned by listSites does not change the registry", () => {
    register(zhihu);
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
    register(m);
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
    register(zhihu);
    expect(dispatchSite("https://weibo.com")).toBeNull();
  });

  it("returns null for an un-navigable URL", () => {
    register(zhihu);
    expect(dispatchSite("about:blank")).toBeNull();
  });

  it("matches an exact origin", () => {
    register(zhihu);
    expect(dispatchSite("https://zhihu.com/question/1")?.id).toBe("zhihu");
  });

  it("matches a subdomain via wildcard", () => {
    register(zhihu);
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
      capabilities: ["read"],
      minAgentApi: 1,
    };
    register(wildcardOwner);
    register(exactOwner);
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
    register(broad);
    register(narrow);
    expect(dispatchSite("https://x.sub.example.com/p")?.id).toBe("narrow");
    // A host only the broad pattern covers still resolves to broad.
    expect(dispatchSite("https://other.example.com/p")?.id).toBe("broad");
  });
});

// WI-NB4.2 — registration is atomic with the plugin's reader: a manifest cannot
// exist without a working implementation, so "registered but unreadable" is
// unrepresentable. WI-NB4.1 consumes the pairing through readerForUrl.
describe("manifest ↔ reader pairing (WI-NB4.2)", () => {
  it("stores the paired reader, retrievable by id", () => {
    const reader = stubReader("zhihu");
    registerSite(zhihu, reader);
    expect(siteReaderById("zhihu")).toBe(reader);
  });

  it("rejects a reader whose id does not match the manifest", () => {
    expect(() => registerSite(zhihu, stubReader("other"))).toThrow(/reader/i);
    expect(getSiteById("zhihu")).toBeUndefined();
  });

  it.each([
    ["missing match", { id: "zhihu", read: stubReader("zhihu").read }],
    ["missing read", { id: "zhihu", match: () => true }],
    ["not an object", null],
  ])("rejects a malformed reader (%s) without committing the manifest", (_label, bad) => {
    expect(() => registerSite(zhihu, bad as unknown as SiteReader)).toThrow();
    expect(getSiteById("zhihu")).toBeUndefined();
    expect(listSites()).toHaveLength(0);
  });
});

describe("readerForUrl (WI-NB4.1 dispatch)", () => {
  it("routes a dispatched site's URL to its paired reader", () => {
    register(zhihu);
    const reader = readerForUrl("https://www.zhihu.com/question/1");
    expect(reader?.id).toBe("zhihu");
  });

  it("falls back to the generic reader when no site claims the origin", () => {
    register(zhihu);
    expect(readerForUrl("https://example.com/article")?.id).toBe("generic");
  });

  it("falls back to generic when the site's reader declines the specific URL", () => {
    registerSite(zhihu, { ...stubReader("zhihu"), match: (url) => url.includes("/question/") });
    expect(readerForUrl("https://zhihu.com/question/42")?.id).toBe("zhihu");
    expect(readerForUrl("https://zhihu.com/settings")?.id).toBe("generic");
  });

  it("returns null for a URL nothing can read", () => {
    expect(readerForUrl("file:///etc/passwd")).toBeNull();
    expect(readerForUrl("not a url")).toBeNull();
  });

  it("a throwing site matcher is contained — generic still reads the page", () => {
    registerSite(zhihu, {
      ...stubReader("zhihu"),
      match: () => {
        throw new Error("plugin bug");
      },
    });
    expect(readerForUrl("https://zhihu.com/x")?.id).toBe("generic");
  });
});
