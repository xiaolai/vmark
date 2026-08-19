// WI-NB4.3 — the Wikipedia site plugin: the registry's first production
// registration, hardened against a bundled fixture. Assertions are about the
// READ RESULT (what survives, what is stripped), never about internals.
import { describe, it, expect } from "vitest";
import { wikipediaSite, wikipediaReader } from "./wikipedia";
import FIXTURE from "./__fixtures__/article.html?raw";

const URL_ARTICLE = "https://en.wikipedia.org/wiki/Markdown";

describe("manifest", () => {
  it("claims wikipedia.org origins, read-only, current API", () => {
    expect(wikipediaSite).toMatchObject({
      id: "wikipedia",
      nameI18nKey: "sites.wikipedia.name",
      capabilities: ["read"],
      minAgentApi: 1,
    });
    expect(wikipediaSite.origins).toContain("https://*.wikipedia.org");
  });
});

describe("match — article namespace only", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Markdown", true],
    ["https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC", true],
    ["https://en.wikipedia.org/w/index.php?title=Special:Search", false],
    ["https://en.wikipedia.org/wiki/Special:RecentChanges", false],
    ["https://en.wikipedia.org/wiki/Talk:Markdown", false],
    ["https://en.wikipedia.org/", false],
  ])("%s → %s", (url, expected) => {
    expect(wikipediaReader.match(url)).toBe(expected);
  });
});

describe("read — against the bundled fixture", () => {
  const result = wikipediaReader.read(FIXTURE, URL_ARTICLE);

  it("keeps the title and the article prose", () => {
    expect(result.title).toBe("Markdown");
    expect(result.markdown).toContain("lightweight markup language");
    expect(result.markdown).toContain("## History");
  });

  it("strips wiki chrome: infobox, navbox, edit links, hatnotes, references markers", () => {
    expect(result.markdown).not.toContain("Infobox datum");
    expect(result.markdown).not.toContain("Navbox link");
    expect(result.markdown).not.toMatch(/\[edit\]|action=edit/);
    expect(result.markdown).not.toContain("This article is about");
    expect(result.markdown).not.toContain("[1]");
  });

  it("reports the read url and a plausible text length", () => {
    expect(result.url).toBe(URL_ARTICLE);
    expect(result.textLength).toBeGreaterThan(50);
  });

  it("never throws on garbage input", () => {
    expect(() => wikipediaReader.read("", URL_ARTICLE)).not.toThrow();
    expect(() => wikipediaReader.read("<not html", URL_ARTICLE)).not.toThrow();
  });
});
