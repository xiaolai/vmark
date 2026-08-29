/**
 * Motion policy — ONE owner for "should this animate?" (R10, WI-UI1.7).
 *
 * Purpose: CSS motion collapses globally under `prefers-reduced-motion`
 * (see index.css), but JS-driven smooth scrolling bypasses CSS entirely —
 * `scrollTo({ behavior: "smooth" })` animates regardless. Every such call
 * goes through `scrollBehavior()`; an eslint `no-restricted-syntax` rule
 * forbids the literal outside this module.
 *
 * @module utils/motion
 */

/** Whether the OS asks for reduced motion. False where matchMedia is absent (jsdom, SSR). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The scroll behavior honouring the OS preference. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
