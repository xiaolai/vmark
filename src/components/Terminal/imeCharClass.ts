/**
 * imeCharClass
 *
 * Purpose: the ASCII / non-ASCII detectors shared by the terminal IME layer.
 * Consolidated here so setupImeComposition and terminalSessionInputWiring use
 * ONE definition instead of three near-identical copies.
 *
 * Written with `\x00-\x7f` escape syntax, NOT a literal U+0080–U+FFFF range: the
 * literal form is correct but its leading U+0080 (a C1 control character) renders
 * invisibly in browsers, terminals, and review tools, making the regex look like
 * `/[-￿]/` and triggering false "matches only `-` and `￿`" bug reports (#910).
 *
 * @module components/Terminal/imeCharClass
 */

/* eslint-disable no-control-regex */

/** True if the string contains ANY code unit above 0x7F (BMP CJK, punctuation…). */
export const NON_ASCII_RE = /[^\x00-\x7f]/;

/** True if the string is entirely ASCII (one or more chars). */
export const ALL_ASCII_RE = /^[\x00-\x7f]+$/;

/* eslint-enable no-control-regex */
