/**
 * Purpose: Path-aware fuzzy matching for Quick Open file search.
 * @coordinates-with QuickOpen UI components
 */

/** Result of a fuzzy match with score, matched character indices, and optional path indices. */
export interface FuzzyMatchResult {
  score: number;
  indices: number[];
  pathIndices?: number[];
}

const SCORE_FIRST_CHAR = 8;
const SCORE_CONSECUTIVE = 5;
const SCORE_WORD_BOUNDARY = 10;
const SCORE_EXACT_PREFIX = 25;
const PENALTY_GAP = -1;
const FILENAME_WEIGHT = 3;

function isWordBoundary(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  if ("-_. /".includes(prev)) return true;
  const cur = target[i];
  if (cur >= "A" && cur <= "Z" && prev >= "a" && prev <= "z") return true;
  return false;
}

function scoreSubsequence(
  queryLower: string,
  targetLower: string,
  target: string,
): { score: number; indices: number[] } | null {
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      indices.push(ti);
      score += 1; // base score per match
      if (ti === 0) score += SCORE_FIRST_CHAR;
      if (lastMatchIdx >= 0 && ti === lastMatchIdx + 1) score += SCORE_CONSECUTIVE;
      if (isWordBoundary(target, ti)) score += SCORE_WORD_BOUNDARY;
      if (lastMatchIdx >= 0) score += (ti - lastMatchIdx - 1) * PENALTY_GAP;
      lastMatchIdx = ti;
      qi++;
    }
  }

  if (qi < queryLower.length) return null;

  if (targetLower.startsWith(queryLower)) score += SCORE_EXACT_PREFIX;

  return { score, indices };
}

function matchWithPathSegments(
  query: string,
  filename: string,
  relPath?: string,
): FuzzyMatchResult | null {
  const parts = query.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const filePart = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);

  const fileResult = scoreSubsequence(filePart.toLowerCase(), filename.toLowerCase(), filename);
  /* v8 ignore next -- @preserve reason: null return when path-style query's file part doesn't match; covered by non-path fuzzyMatch tests */
  if (!fileResult) return null;

  if (dirParts.length > 0 && relPath) {
    const pathDirs = relPath.split("/").slice(0, -1);
    let pi = 0;
    for (const dq of dirParts) {
      let found = false;
      while (pi < pathDirs.length) {
        if (scoreSubsequence(dq.toLowerCase(), pathDirs[pi].toLowerCase(), pathDirs[pi])) {
          pi++;
          found = true;
          break;
        }
        pi++;
      }
      if (!found) return null;
    }
  } else if (dirParts.length > 0) {
    return null;
  }

  return { score: fileResult.score * FILENAME_WEIGHT, indices: fileResult.indices };
}

/** Perform fuzzy matching of a query against a filename and optional relative path. */
export function fuzzyMatch(
  query: string,
  filename: string,
  relPath?: string,
): FuzzyMatchResult | null {
  if (!query) return null;

  if (query.includes("/")) return matchWithPathSegments(query, filename, relPath);

  const queryLower = query.toLowerCase();
  const fileResult = scoreSubsequence(queryLower, filename.toLowerCase(), filename);
  const filenameScore = fileResult ? fileResult.score * FILENAME_WEIGHT : 0;

  let pathScore = 0;
  let pathIndices: number[] | undefined;
  if (relPath) {
    const pathResult = scoreSubsequence(queryLower, relPath.toLowerCase(), relPath);
    if (pathResult) {
      pathScore = pathResult.score;
      pathIndices = pathResult.indices;
    }
  }

  const combined = filenameScore + pathScore;
  if (combined <= 0 || (!fileResult && !pathIndices)) return null;

  // `pathIndices` is omitted, not set to undefined: its absence is what "the
  // path contributed no match" means, and the highlighter checks presence.
  return {
    score: combined,
    indices: fileResult?.indices ?? [],
    ...(pathIndices ? { pathIndices } : {}),
  };
}
