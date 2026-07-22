/**
 * Claim protocol tests — ADR-015 D2b, WI-1.3.
 *
 * @module lib/extensions/claim.test
 */
import { describe, it, expect } from "vitest";
import { resolveClaim, type Recognizer } from "./claim";

interface Node {
  type: string;
  url?: string;
  tag?: string;
}

function recognizer(
  extensionId: string,
  nodeType: string,
  fn: (node: Node) => ReturnType<Recognizer<Node, string>["recognize"]>,
): Recognizer<Node, string> {
  return { extensionId, nodeType, recognize: fn };
}

const IMAGE: Node = { type: "image", url: "clip.mp4" };

describe("resolveClaim", () => {
  describe("basic resolution", () => {
    it("returns no winner when nothing recognizes the node", () => {
      const result = resolveClaim([], IMAGE, "image");
      expect(result.winner).toBeNull();
      expect(result.error).toBeNull();
    });

    it("returns the only claimant", () => {
      const video = recognizer("vmark.video", "image", () => ({
        strength: "semantic",
        value: "block_video",
        reason: "extension .mp4",
      }));
      const result = resolveClaim([video], IMAGE, "image");
      expect(result.winner?.extensionId).toBe("vmark.video");
      expect(result.winner?.claim.value).toBe("block_video");
    });

    it("ignores recognizers registered for a different node type", () => {
      const html = recognizer("vmark.embed", "html", () => ({
        strength: "exact",
        value: "video_embed",
        reason: "iframe",
      }));
      expect(resolveClaim([html], IMAGE, "image").winner).toBeNull();
    });

    it("ignores a recognizer that declines", () => {
      const declines = recognizer("vmark.audio", "image", () => null);
      expect(resolveClaim([declines], IMAGE, "image").winner).toBeNull();
    });
  });

  describe("strength ranking", () => {
    it("exact beats semantic", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.semantic", "image", () => ({
            strength: "semantic",
            value: "block_video",
            reason: "extension",
          })),
          recognizer("vmark.exact", "image", () => ({
            strength: "exact",
            value: "video_embed",
            reason: "explicit tag",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.winner?.extensionId).toBe("vmark.exact");
      expect(result.error).toBeNull();
    });

    it("semantic beats fallback", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.paragraph", "image", () => ({
            strength: "fallback",
            value: "paragraph",
            reason: "default",
          })),
          recognizer("vmark.video", "image", () => ({
            strength: "semantic",
            value: "block_video",
            reason: "extension .mp4",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.winner?.claim.value).toBe("block_video");
    });

    it("uses fallback when it is the only claim", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.paragraph", "image", () => ({
            strength: "fallback",
            value: "paragraph",
            reason: "default",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.winner?.claim.value).toBe("paragraph");
    });
  });

  describe("conflicts are errors, not ordering contests", () => {
    it("rejects two claims at the winning strength", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.video", "image", () => ({
            strength: "semantic",
            value: "block_video",
            reason: "extension .mp4",
          })),
          recognizer("vmark.audio", "image", () => ({
            strength: "semantic",
            value: "block_audio",
            reason: "extension .mp4",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.winner).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.error?.extensionIds).toEqual(["vmark.video", "vmark.audio"]);
      expect(result.error?.strength).toBe("semantic");
    });

    it("does not treat a lower-strength claim as a conflict", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.video", "image", () => ({
            strength: "exact",
            value: "block_video",
            reason: "tag",
          })),
          recognizer("vmark.a", "image", () => ({
            strength: "semantic",
            value: "x",
            reason: "guess",
          })),
          recognizer("vmark.b", "image", () => ({
            strength: "semantic",
            value: "y",
            reason: "guess",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.error).toBeNull();
      expect(result.winner?.extensionId).toBe("vmark.video");
    });

    it("names the node type and reasons in the conflict message", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.video", "image", () => ({
            strength: "exact",
            value: "block_video",
            reason: "video tag",
          })),
          recognizer("vmark.audio", "image", () => ({
            strength: "exact",
            value: "block_audio",
            reason: "audio tag",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.error?.message).toContain("image");
      expect(result.error?.message).toContain("video tag");
      expect(result.error?.message).toContain("audio tag");
    });
  });

  describe("trace", () => {
    it("records every bid, including losers and decliners", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.exact", "image", () => ({
            strength: "exact",
            value: "a",
            reason: "r1",
          })),
          recognizer("vmark.semantic", "image", () => ({
            strength: "semantic",
            value: "b",
            reason: "r2",
          })),
          recognizer("vmark.declines", "image", () => null),
        ],
        IMAGE,
        "image",
      );
      expect(result.bids).toHaveLength(2);
      expect(result.bids.map((b) => b.extensionId)).toEqual([
        "vmark.exact",
        "vmark.semantic",
      ]);
    });

    it("records bids even when the result is a conflict", () => {
      const result = resolveClaim(
        [
          recognizer("a", "image", () => ({ strength: "exact", value: "1", reason: "r" })),
          recognizer("b", "image", () => ({ strength: "exact", value: "2", reason: "r" })),
        ],
        IMAGE,
        "image",
      );
      expect(result.bids).toHaveLength(2);
    });
  });

  describe("recognizer robustness", () => {
    it("treats a throwing recognizer as a declining one and records it", () => {
      const result = resolveClaim(
        [
          recognizer("vmark.broken", "image", () => {
            throw new Error("boom");
          }),
          recognizer("vmark.ok", "image", () => ({
            strength: "semantic",
            value: "block_video",
            reason: "ok",
          })),
        ],
        IMAGE,
        "image",
      );
      expect(result.winner?.extensionId).toBe("vmark.ok");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].extensionId).toBe("vmark.broken");
    });
  });
});
