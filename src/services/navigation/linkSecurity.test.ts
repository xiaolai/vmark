/**
 * The link security chain, end to end.
 *
 * VMark stores the author's URL VERBATIM — sanitizing at the MDAST→PM
 * boundary rewrote the user's file on save (`[x](s3://…)` became
 * `[x](about:blank)`). That is only correct if the layers that ACTIVATE a
 * URL refuse the dangerous ones on their own, so this suite pins the two
 * properties together:
 *
 *   PRESERVATION — every scheme survives a round trip unchanged.
 *   CONTAINMENT  — a dangerous scheme still cannot be rendered as a live
 *                  href, and still cannot reach the OS opener.
 *
 * Isolated unit tests of each layer existed; nothing proved the CHAIN, which
 * is what makes removing a redundant layer safe rather than reckless.
 *
 * @coordinates-with @/utils/markdownPipeline/mdastInlineConverters.ts — stores the URL verbatim
 * @coordinates-with ./linkOpen — the activation allowlist
 * @coordinates-with @/services/assembly/linkExtension — Tiptap's renderHTML
 * @module services/navigation/linkSecurity.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";
import { getProductionSchema } from "@/test/productionSchema";

// `vi.mock` is hoisted above module scope, so the spy must be too
// (10-tdd.md: use `vi.hoisted` when mock setup runs before imports).
const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const schema = getProductionSchema();
const roundTrip = (md: string) =>
  serializeMarkdown(schema, parseMarkdown(schema, md)).trim();

/** Schemes an author may legitimately have in a document. */
const HARMLESS_SCHEMES = [
  "s3://bucket/key",
  "irc://irc.example.test/chan",
  "obsidian://open?vault=notes",
  "zotero://select/items/1",
  "ftp://files.example.test/pub",
  "custom-app://do/thing",
];

/** Schemes that must never reach a live href or the OS opener. */
const DANGEROUS_SCHEMES = [
  "javascript:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
];

describe("PRESERVATION — the author's URL survives a save", () => {
  for (const url of [...HARMLESS_SCHEMES, ...DANGEROUS_SCHEMES]) {
    it(`round-trips ${url} unchanged`, () => {
      const out = roundTrip(`[label](${url})`);
      expect(out).toContain(url);
      // and is stable on a second save
      expect(roundTrip(out)).toBe(out);
    });
  }

  it("no longer rewrites anything to about:blank", () => {
    for (const url of [...HARMLESS_SCHEMES, ...DANGEROUS_SCHEMES]) {
      expect(roundTrip(`[label](${url})`)).not.toContain("about:blank");
    }
  });

  it("preserves an image src with an unrecognized scheme", () => {
    expect(roundTrip("![alt](s3://bucket/pic.png)")).toContain("s3://bucket/pic.png");
  });
});

describe("CONTAINMENT — activation refuses what storage preserves", () => {
  // The REAL settings store, per the mock-boundaries rule: tests mock
  // boundaries (the OS opener), not app state.
  let originalProtocols: string[];

  beforeEach(async () => {
    openUrl.mockReset().mockResolvedValue(undefined);
    const { useSettingsStore } = await import("@/stores/settingsStore");
    originalProtocols =
      useSettingsStore.getState().advanced.customLinkProtocols ?? [];
  });

  afterEach(async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState((state) => ({
      advanced: { ...state.advanced, customLinkProtocols: originalProtocols },
    }));
  });

  async function setProtocols(protocols: string[]): Promise<void> {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState((state) => ({
      advanced: { ...state.advanced, customLinkProtocols: protocols },
    }));
  }

  for (const url of DANGEROUS_SCHEMES) {
    it(`refuses to open ${url}`, async () => {
      await setProtocols([]);
      const { openExternalLink } = await import("./linkOpen");
      expect(await openExternalLink(url)).toBe(false);
      expect(openUrl).not.toHaveBeenCalled();
    });
  }

  it("refuses a dangerous scheme even if the user configures it", async () => {
    // The built-in denial is not overridable by a setting — `javascript` is
    // not a protocol a user may opt into.
    await setProtocols(["javascript"]);
    const { openExternalLink } = await import("./linkOpen");
    await openExternalLink("javascript:alert(1)");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("refuses an unconfigured harmless scheme", async () => {
    await setProtocols([]);
    const { openExternalLink } = await import("./linkOpen");
    expect(await openExternalLink("s3://bucket/key")).toBe(false);
  });

  it("opens a harmless scheme the user HAS configured", async () => {
    await setProtocols(["s3"]);
    const { openExternalLink } = await import("./linkOpen");
    expect(await openExternalLink("s3://bucket/key")).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("s3://bucket/key");
  });

  it("opens an ordinary https link", async () => {
    const { openExternalLink } = await import("./linkOpen");
    expect(await openExternalLink("https://example.com")).toBe(true);
    expect(openUrl).toHaveBeenCalled();
  });
});

describe("CONTAINMENT — rendering refuses a dangerous href", () => {
  it("Tiptap's link extension does not emit a dangerous href into the DOM", async () => {
    const { vmarkLinkExtension } = await import("@/services/assembly/linkExtension");
    // Tiptap validates the URI in renderHTML; a blocked scheme must not
    // appear as a live href even though the PM attribute retains it.
    const rendered = vmarkLinkExtension.config.renderHTML?.call(
      { options: vmarkLinkExtension.options } as never,
      {
        HTMLAttributes: { href: "javascript:alert(1)" },
        mark: { attrs: { href: "javascript:alert(1)" } },
      } as never,
    );
    expect(JSON.stringify(rendered ?? "")).not.toContain("javascript:alert(1)");
  });
});
