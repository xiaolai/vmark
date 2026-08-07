// @vitest-environment node
/**
 * Paragraph claim tests — Phase 2, ADR-015 D2b.
 *
 * The point of the protocol is that ownership stops depending on `if`-order.
 * These tests assert that directly: shuffling the recognizer array must not
 * change which converter wins.
 *
 * @module utils/markdownPipeline/mdastParagraphClaims.test
 */
import { describe, it, expect } from "vitest";
import { resolveClaim } from "@/lib/extensions/claim";
import {
  PARAGRAPH_RECOGNIZERS,
  type ParagraphClaimInput,
} from "./mdastParagraphClaims";

type Child = ParagraphClaimInput["onlyChild"];

function input(overrides: Partial<ParagraphClaimInput> = {}): ParagraphClaimInput {
  return {
    node: { type: "paragraph", children: [] },
    onlyChild: null,
    promoteMedia: () => null,
    promoteHtml: () => null,
    buildBlockImage: () => null,
    buildParagraph: () => null,
    ...overrides,
  } as ParagraphClaimInput;
}

const imageChild = { type: "image", url: "clip.mp4" } as unknown as Child;
const htmlChild = { type: "html", value: "<video src='a.mp4'></video>" } as unknown as Child;

function winner(
  args: ParagraphClaimInput,
  recognizers = PARAGRAPH_RECOGNIZERS,
): string | undefined {
  return resolveClaim(recognizers, args, "paragraph").winner?.extensionId;
}

describe("paragraph claims", () => {
  it("falls back to paragraph when there is no lone child", () => {
    expect(winner(input())).toBe("vmark.paragraph");
  });

  it("prefers media over block image for a video URL", () => {
    const media = { marker: "media" } as never;
    expect(
      winner(
        input({
          onlyChild: imageChild,
          promoteMedia: () => media,
          buildBlockImage: () => ({ marker: "blockImage" }) as never,
        }),
      ),
    ).toBe("vmark.blockMedia");
  });

  it("uses block image when the URL is not media", () => {
    expect(
      winner(
        input({
          onlyChild: { type: "image", url: "pic.png" } as unknown as Child,
          promoteMedia: () => null,
          buildBlockImage: () => ({ marker: "blockImage" }) as never,
        }),
      ),
    ).toBe("vmark.blockImage");
  });

  it("claims media HTML for a lone <video> child", () => {
    expect(
      winner(input({ onlyChild: htmlChild, promoteHtml: () => ({ m: 1 }) as never })),
    ).toBe("vmark.mediaHtml");
  });

  it("falls back to paragraph when the lone html child is not media", () => {
    expect(winner(input({ onlyChild: htmlChild, promoteHtml: () => null }))).toBe(
      "vmark.paragraph",
    );
  });

  describe("ordering independence — the reason the protocol exists", () => {
    const args = input({
      onlyChild: imageChild,
      promoteMedia: () => ({ marker: "media" }) as never,
      buildBlockImage: () => ({ marker: "blockImage" }) as never,
      buildParagraph: () => ({ marker: "paragraph" }) as never,
    });

    it("picks the same winner with the recognizers reversed", () => {
      const forward = winner(args, PARAGRAPH_RECOGNIZERS);
      const reversed = winner(args, [...PARAGRAPH_RECOGNIZERS].reverse());
      expect(reversed).toBe(forward);
      expect(reversed).toBe("vmark.blockMedia");
    });

    it("picks the same winner for every rotation of the array", () => {
      const expected = winner(args);
      for (let i = 0; i < PARAGRAPH_RECOGNIZERS.length; i++) {
        const rotated = [
          ...PARAGRAPH_RECOGNIZERS.slice(i),
          ...PARAGRAPH_RECOGNIZERS.slice(0, i),
        ];
        expect(winner(args, rotated), `rotation ${i}`).toBe(expected);
      }
    });
  });

  it("records every bid, so ownership is explainable", () => {
    const resolution = resolveClaim(
      PARAGRAPH_RECOGNIZERS,
      input({
        onlyChild: imageChild,
        promoteMedia: () => ({ m: 1 }) as never,
        buildBlockImage: () => ({ m: 2 }) as never,
        buildParagraph: () => ({ m: 3 }) as never,
      }),
      "paragraph",
    );
    // media (exact) + blockImage (semantic) + paragraph (fallback)
    expect(resolution.bids).toHaveLength(3);
    expect(resolution.bids.map((b) => b.claim.strength)).toEqual([
      "exact",
      "semantic",
      "fallback",
    ]);
    expect(resolution.error).toBeNull();
  });
});
