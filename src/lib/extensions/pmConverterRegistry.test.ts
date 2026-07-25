/**
 * Registry 2 dispatch tests — ADR-015 D2, Phase 2.
 *
 * @module lib/extensions/pmConverterRegistry.test
 */
import { describe, it, expect } from "vitest";
import {
  ConverterRegistrationError,
  PmConverterRegistry,
  type PmConverter,
} from "./pmConverterRegistry";

interface Node {
  name: string;
  language?: string;
}

type Registry = PmConverterRegistry<Node, null, string>;

function make(
  extensionId: string,
  nodeName: string,
  out: string,
  match?: (node: Node) => boolean,
): PmConverter<Node, null, string> {
  return { extensionId, nodeName, match, convert: () => out };
}

function registry(...converters: PmConverter<Node, null, string>[]): Registry {
  const reg = new PmConverterRegistry<Node, null, string>();
  reg.registerAll(converters);
  return reg;
}

describe("PmConverterRegistry", () => {
  describe("name-indexed dispatch", () => {
    it("resolves a default converter by node name", () => {
      const reg = registry(make("vmark.code", "codeBlock", "code"));
      const lookup = reg.resolve("codeBlock", { name: "codeBlock" });
      expect(lookup.ok).toBe(true);
      if (lookup.ok) expect(lookup.converter.extensionId).toBe("vmark.code");
    });

    it("reports unknown nodes rather than silently returning nothing", () => {
      const reg = registry();
      const lookup = reg.resolve("mystery", { name: "mystery" });
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) {
        expect(lookup.failure.code).toBe("unknown-node");
        expect(lookup.failure.message).toContain("silently drop");
      }
    });

    it("lists known node names", () => {
      const reg = registry(
        make("a", "paragraph", "p"),
        make("b", "heading", "h"),
        make("c", "codeBlock", "math", (n) => n.language === "math"),
      );
      expect(reg.knownNodeNames()).toEqual(["codeBlock", "heading", "paragraph"]);
    });
  });

  describe("attribute-level claiming", () => {
    it("prefers a matching predicate over the name default", () => {
      const reg = registry(
        make("vmark.code", "codeBlock", "code"),
        make("vmark.math", "codeBlock", "math", (n) => n.language === "math"),
      );
      const lookup = reg.resolve("codeBlock", { name: "codeBlock", language: "math" });
      expect(lookup.ok && lookup.converter.extensionId).toBe("vmark.math");
    });

    it("falls back to the default when no predicate matches", () => {
      const reg = registry(
        make("vmark.code", "codeBlock", "code"),
        make("vmark.math", "codeBlock", "math", (n) => n.language === "math"),
      );
      const lookup = reg.resolve("codeBlock", { name: "codeBlock", language: "ts" });
      expect(lookup.ok && lookup.converter.extensionId).toBe("vmark.code");
    });

    it("resolves a predicate-only node name with no default", () => {
      const reg = registry(make("vmark.math", "codeBlock", "math", () => true));
      expect(reg.resolve("codeBlock", { name: "codeBlock" }).ok).toBe(true);
    });

    it("reports unknown-node when a predicate exists but declines", () => {
      const reg = registry(make("vmark.math", "codeBlock", "math", () => false));
      const lookup = reg.resolve("codeBlock", { name: "codeBlock" });
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) expect(lookup.failure.code).toBe("unknown-node");
    });
  });

  describe("conflicts", () => {
    it("rejects two defaults for one node name at REGISTRATION time", () => {
      expect(() =>
        registry(make("a", "paragraph", "1"), make("b", "paragraph", "2")),
      ).toThrow(ConverterRegistrationError);
    });

    it("names both extensions in the registration error", () => {
      let message = "";
      try {
        registry(make("vmark.a", "paragraph", "1"), make("vmark.b", "paragraph", "2"));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("vmark.a");
      expect(message).toContain("vmark.b");
    });

    it("reports two matching predicates as ambiguous, not first-wins", () => {
      const reg = registry(
        make("vmark.video", "image", "video", () => true),
        make("vmark.audio", "image", "audio", () => true),
      );
      const lookup = reg.resolve("image", { name: "image" });
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) {
        expect(lookup.failure.code).toBe("ambiguous-match");
        if (lookup.failure.code === "ambiguous-match") {
          expect(lookup.failure.extensionIds).toEqual(["vmark.video", "vmark.audio"]);
        }
      }
    });

    it("rejects a converter with no nodeName", () => {
      expect(() => registry(make("a", "", "x"))).toThrow(ConverterRegistrationError);
    });
  });

  describe("robustness", () => {
    it("treats a throwing predicate as declining, not as a document failure", () => {
      const reg = registry(
        make("vmark.code", "codeBlock", "code"),
        {
          extensionId: "vmark.broken",
          nodeName: "codeBlock",
          match: () => {
            throw new Error("boom");
          },
          convert: () => "broken",
        },
      );
      const lookup = reg.resolve("codeBlock", { name: "codeBlock" });
      expect(lookup.ok && lookup.converter.extensionId).toBe("vmark.code");
    });
  });
});
