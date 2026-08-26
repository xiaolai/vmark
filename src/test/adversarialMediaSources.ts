/**
 * The media sources every resolver must REFUSE, in one place.
 *
 * VMark has three of them — `services/media/resolveMediaSrc.ts`,
 * `plugins/imageView/resolveSrc.ts` and `plugins/imagePreview/resolveSrc.ts` —
 * and all three independently grew the same defect: a source they could not
 * classify fell past every branch and left through a closing `return src`, so
 * the input came back verbatim and went into an element's `src`.
 *
 * That is harmless for a PATH. The webview resolves an unresolved relative src
 * against the app origin, never `file://`, so it cannot reach the disk — two of
 * the resolvers deliberately return such a path unchanged, and their tests say
 * so. It is NOT harmless for a URI SCHEME: `file:` addresses the disk, and a
 * custom scheme addresses whatever the app registered for it, which here
 * includes the `vmark-trusted://` origin that serves script-enabled documents.
 *
 * The list is exported rather than copied into three test files because the
 * defect's defining feature was that it appeared in all three independently.
 * A copy would let one resolver quietly stop asserting a case; a fourth
 * resolver that never imports this is visible for exactly the same reason.
 *
 * @coordinates-with plugins/shared/mediaSecurity.ts — hasUriScheme
 * @module test/adversarialMediaSources
 */

/** `[label, source]` — every entry must resolve to the empty string. */
export const ADVERSARIAL_MEDIA_SOURCES: readonly (readonly [string, string])[] = [
  ["javascript:", "javascript:alert(1)"],
  ["uppercase JavaScript:", "JavaScript:alert(1)"],
  ["file:", "file:///etc/passwd"],
  ["the app's own trusted origin", "vmark-trusted://doc/abcdef"],
  ["blob:", "blob:https://evil.example/1234"],
  ["an arbitrary custom scheme", "x-launch://run?cmd=rm"],
  ["a scheme hidden by angle brackets", "<javascript:alert(1)>"],
  ["a scheme hidden by percent-encoding", "javascript%3Aalert(1)"],
];
