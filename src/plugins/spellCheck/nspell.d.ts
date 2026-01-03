/**
 * Type declarations for nspell package
 */

declare module "nspell" {
  interface NSpellOptions {
    aff: string | Buffer;
    dic?: string | Buffer;
  }

  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
    remove(word: string): void;
    wordCharacters(): RegExp | null;
    dictionary(dic: string | Buffer): void;
    personal(dic: string | Buffer): void;
  }

  function nspell(options: NSpellOptions): NSpell;
  export = nspell;
}
