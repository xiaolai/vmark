import type { LintRule } from "../types";
import { noReversedLink } from "./noReversedLink";
import { noMissingSpaceAtx } from "./noMissingSpaceAtx";
import { noSpaceInEmphasis } from "./noSpaceInEmphasis";
import { unclosedFencedCode } from "./unclosedFencedCode";
import { noUndefinedRefs } from "./noUndefinedRefs";
import { tableColumnCount } from "./tableColumnCount";
import { noEmptyLinkText } from "./noEmptyLinkText";
import { noDuplicateDefs } from "./noDuplicateDefs";
import { headingIncrement } from "./headingIncrement";
import { requireAltText } from "./requireAltText";
import { noUnusedDefs } from "./noUnusedDefs";
import { linkFragments } from "./linkFragments";
import { noEmptyLinkHref } from "./noEmptyLinkHref";

/** All registered lint rules. Order doesn't matter — diagnostics are sorted after collection. */
export const allRules: LintRule[] = [
  noReversedLink,
  noMissingSpaceAtx,
  noSpaceInEmphasis,
  unclosedFencedCode,
  noUndefinedRefs,
  tableColumnCount,
  noEmptyLinkText,
  noDuplicateDefs,
  headingIncrement,
  requireAltText,
  noUnusedDefs,
  linkFragments,
  noEmptyLinkHref,
];
