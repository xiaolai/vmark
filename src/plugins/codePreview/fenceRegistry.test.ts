// @vitest-environment node
/**
 * Fence extension-point tests — ADR-015 D3, Phase 5 WI-5.1.
 *
 * @module plugins/codePreview/fenceRegistry.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  FenceRegistrationError,
  _resetFenceRenderers,
  hasFenceRenderer,
  registerFenceRenderer,
  registeredFenceLanguages,
  resolveFenceRenderer,
  type FenceRenderer,
} from "./fenceRegistry";

const decoration = {} as never;

function renderer(
  extensionId: string,
  overrides: Partial<FenceRenderer> = {},
): FenceRenderer {
  return { extensionId, create: () => decoration, ...overrides };
}

beforeEach(() => {
  _resetFenceRenderers();
});

describe("fence extension point", () => {
  describe("exact language claims", () => {
    it("resolves a registered language", () => {
      registerFenceRenderer(renderer("vmark.mermaid", { languages: ["mermaid"] }));
      expect(resolveFenceRenderer("mermaid")?.extensionId).toBe("vmark.mermaid");
    });

    it("returns null for an unclaimed language", () => {
      registerFenceRenderer(renderer("vmark.mermaid", { languages: ["mermaid"] }));
      expect(resolveFenceRenderer("python")).toBeNull();
      expect(hasFenceRenderer("python")).toBe(false);
    });

    it("supports one renderer claiming several languages", () => {
      registerFenceRenderer(renderer("vmark.workflow", { languages: ["yaml", "yml"] }));
      expect(resolveFenceRenderer("yaml")?.extensionId).toBe("vmark.workflow");
      expect(resolveFenceRenderer("yml")?.extensionId).toBe("vmark.workflow");
    });

    it("lists registered languages sorted", () => {
      registerFenceRenderer(renderer("a", { languages: ["svg"] }));
      registerFenceRenderer(renderer("b", { languages: ["mermaid", "markmap"] }));
      expect(registeredFenceLanguages()).toEqual(["markmap", "mermaid", "svg"]);
    });
  });

  describe("predicate families", () => {
    it("resolves via a predicate when no exact claim matches", () => {
      registerFenceRenderer(
        renderer("vmark.graphviz", { matches: (l) => l === "dot" || l === "graphviz" }),
      );
      expect(resolveFenceRenderer("dot")?.extensionId).toBe("vmark.graphviz");
      expect(resolveFenceRenderer("graphviz")?.extensionId).toBe("vmark.graphviz");
    });

    it("prefers an exact claim over a predicate family", () => {
      registerFenceRenderer(renderer("vmark.broad", { matches: () => true }));
      registerFenceRenderer(renderer("vmark.mermaid", { languages: ["mermaid"] }));
      expect(resolveFenceRenderer("mermaid")?.extensionId).toBe("vmark.mermaid");
    });

    it("is unaffected by registration order", () => {
      _resetFenceRenderers();
      registerFenceRenderer(renderer("vmark.mermaid", { languages: ["mermaid"] }));
      registerFenceRenderer(renderer("vmark.broad", { matches: () => true }));
      expect(resolveFenceRenderer("mermaid")?.extensionId).toBe("vmark.mermaid");
    });

    it("treats a throwing predicate as declining", () => {
      registerFenceRenderer(
        renderer("vmark.broken", {
          matches: () => {
            throw new Error("boom");
          },
        }),
      );
      expect(resolveFenceRenderer("anything")).toBeNull();
    });
  });

  describe("conflicts are errors, not races", () => {
    it("rejects two renderers claiming one language at registration", () => {
      registerFenceRenderer(renderer("vmark.a", { languages: ["mermaid"] }));
      expect(() =>
        registerFenceRenderer(renderer("vmark.b", { languages: ["mermaid"] })),
      ).toThrow(FenceRegistrationError);
    });

    it("names both extensions in the registration error", () => {
      registerFenceRenderer(renderer("vmark.a", { languages: ["svg"] }));
      let message = "";
      try {
        registerFenceRenderer(renderer("vmark.b", { languages: ["svg"] }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("vmark.a");
      expect(message).toContain("vmark.b");
    });

    it("reports two matching predicate families as ambiguous", () => {
      registerFenceRenderer(renderer("vmark.a", { matches: (l) => l.startsWith("d") }));
      registerFenceRenderer(renderer("vmark.b", { matches: (l) => l.endsWith("t") }));
      expect(() => resolveFenceRenderer("dot")).toThrow(FenceRegistrationError);
    });

    it("rejects a renderer that can never claim anything", () => {
      expect(() => registerFenceRenderer(renderer("vmark.dead"))).toThrow(
        FenceRegistrationError,
      );
      expect(() =>
        registerFenceRenderer(renderer("vmark.empty", { languages: [] })),
      ).toThrow(FenceRegistrationError);
    });
  });

  describe("lifecycle-bound registration (WI-5.6)", () => {
    it("returns an unregister function that removes the claim", () => {
      const dispose = registerFenceRenderer(
        renderer("vmark.mermaid", { languages: ["mermaid"] }),
      );
      expect(resolveFenceRenderer("mermaid")).not.toBeNull();
      dispose();
      expect(resolveFenceRenderer("mermaid")).toBeNull();
    });

    it("frees the language so another renderer may claim it", () => {
      const dispose = registerFenceRenderer(
        renderer("vmark.a", { languages: ["mermaid"] }),
      );
      dispose();
      // Would throw on a stale claim; must not.
      registerFenceRenderer(renderer("vmark.b", { languages: ["mermaid"] }));
      expect(resolveFenceRenderer("mermaid")?.extensionId).toBe("vmark.b");
    });

    it("is idempotent — a second call cannot remove someone else's claim", () => {
      const dispose = registerFenceRenderer(
        renderer("vmark.a", { languages: ["mermaid"] }),
      );
      dispose();
      registerFenceRenderer(renderer("vmark.b", { languages: ["mermaid"] }));
      dispose();
      expect(resolveFenceRenderer("mermaid")?.extensionId).toBe("vmark.b");
    });

    it("unregisters a predicate family too", () => {
      const dispose = registerFenceRenderer(
        renderer("vmark.graphviz", { matches: (l) => l === "dot" }),
      );
      expect(resolveFenceRenderer("dot")).not.toBeNull();
      dispose();
      expect(resolveFenceRenderer("dot")).toBeNull();
    });
  });

  describe("peer contribution — the D3 property", () => {
    it("lets a renderer be registered without markdown knowing its name", () => {
      // The host declares the point; the contributor supplies everything about
      // itself. Nothing here references a markdown-side list.
      registerFenceRenderer(
        renderer("acme.sequenceDiagram", {
          languages: ["sequence"],
          emptyLabelKey: "acme:preview.emptySequence",
        }),
      );
      const found = resolveFenceRenderer("sequence");
      expect(found?.extensionId).toBe("acme.sequenceDiagram");
      expect(found?.emptyLabelKey).toBe("acme:preview.emptySequence");
    });
  });
});
