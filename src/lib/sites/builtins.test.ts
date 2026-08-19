// @vitest-environment node
// WI-NB4.3 — built-in registration: idempotent, and the registry actually
// resolves Wikipedia end-to-end after it.
import { describe, it, expect, beforeEach } from "vitest";
import { ensureBuiltinSitesRegistered, __resetBuiltinSites } from "./builtins";
import { __resetSiteRegistry, dispatchSite, readerForUrl } from "./registry";

beforeEach(() => {
  __resetSiteRegistry();
  __resetBuiltinSites();
});

describe("ensureBuiltinSitesRegistered", () => {
  it("registers wikipedia and is idempotent", () => {
    ensureBuiltinSitesRegistered();
    ensureBuiltinSitesRegistered(); // a second call must not throw on duplicate id
    expect(dispatchSite("https://en.wikipedia.org/wiki/Markdown")?.id).toBe("wikipedia");
  });

  it("readerForUrl routes an article to the wikipedia reader and chrome pages to generic", () => {
    ensureBuiltinSitesRegistered();
    expect(readerForUrl("https://en.wikipedia.org/wiki/Markdown")?.id).toBe("wikipedia");
    expect(readerForUrl("https://en.wikipedia.org/wiki/Special:Search")?.id).toBe("generic");
    expect(readerForUrl("https://example.com/post")?.id).toBe("generic");
  });
});
