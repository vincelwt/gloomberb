
/** Simple fuzzy matching: all query chars must appear in order in target */
export function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return { match: true, score: 0 };
  if (t === q) return { match: true, score: 2500 - q.length };

  const tokens = t.split(/\s+/).filter(Boolean);
  const exactTokenIndex = tokens.findIndex((token) => token === q);
  if (exactTokenIndex >= 0) return { match: true, score: 2200 - q.length - exactTokenIndex };

  const prefixTokenIndex = tokens.findIndex((token) => token.startsWith(q));
  if (prefixTokenIndex >= 0) {
    const token = tokens[prefixTokenIndex]!;
    return { match: true, score: 1000 - q.length - prefixTokenIndex - (token.length - q.length) };
  }

  if (t.includes(q)) return { match: true, score: 500 - q.length }; // substring match

  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-" ? 10 : 1;
      qi++;
    }
  }

  return { match: qi === q.length, score };
}

/** Filter and sort items by fuzzy match score */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (!query) return items;
  return items
    .map((item) => ({ item, ...fuzzyMatch(query, getText(item)) }))
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
