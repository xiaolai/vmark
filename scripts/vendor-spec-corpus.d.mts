/** Type surface of the vendoring converter, for its unit tests. */
export interface SpecTxtExample {
  example: number;
  section: string;
  markdown: string;
  html: string;
}
export function parseSpecTxt(text: string): SpecTxtExample[];
export function restoreTabs(text: string): string;
export function filterSections(
  examples: SpecTxtExample[],
  sections: string[],
): SpecTxtExample[];
export function fromCommonMarkJson(
  entries: { example: number; section: string; markdown: string; html: string }[],
): SpecTxtExample[];
export function wrapCorpus(
  provenance: { source: string; revision: string; license: string },
  examples: SpecTxtExample[],
): {
  source: string;
  revision: string;
  license: string;
  examples: SpecTxtExample[];
};
