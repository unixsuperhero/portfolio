export interface MatchResult<T> { exact: T | null; matches: T[] }

/** hiiro's Matcher.by_prefix: an exact name wins, else every item whose name starts with the input. */
export function matchByPrefix<T>(items: T[], input: string, nameOf: (item: T) => string): MatchResult<T> {
  const exact = items.find(item => nameOf(item) === input) ?? null;
  const matches = items.filter(item => nameOf(item).startsWith(input));
  return { exact, matches };
}
