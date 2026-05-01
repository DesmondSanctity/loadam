/**
 * Tiny rule-based singularizer. Not industrial-strength — covers the common
 * English plural forms we see in REST paths. Users with weird domains can
 * override via `x-loadam-resource` extensions (V1.1).
 */

const IRREGULAR: Record<string, string> = {
  people: "person",
  children: "child",
  men: "man",
  women: "woman",
  feet: "foot",
  teeth: "tooth",
  geese: "goose",
  mice: "mouse",
  data: "datum",
  media: "medium",
  criteria: "criterion",
  series: "series",
  species: "species",
};

/**
 * Singularize a noun. Returns the input unchanged if no rule matches.
 * Designed to be safe — wrong-but-stable beats clever-but-flaky.
 */
export function singularize(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  if (lower in IRREGULAR) return preserveCase(word, IRREGULAR[lower] ?? word);

  // -ies → -y  (categories → category)
  if (/[^aeiou]ies$/i.test(word)) {
    return word.slice(0, -3) + (isUpper(word.slice(-3, -2)) ? "Y" : "y");
  }
  // -ves → -f / -fe   (knives → knife, leaves → leaf)
  if (/ves$/i.test(word) && word.length > 3) {
    return word.slice(0, -3) + (isUpper(word.slice(-3, -2)) ? "F" : "f");
  }
  // -sses, -shes, -ches, -xes, -zes → drop -es
  if (/(sses|shes|ches|xes|zes)$/i.test(word)) {
    return word.slice(0, -2);
  }
  // -us / -ss / -is — leave alone (status, address, analysis)
  if (/(us|ss|is)$/i.test(word)) return word;
  // generic -s
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);

  return word;
}

function isUpper(ch: string): boolean {
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function preserveCase(source: string, replacement: string): string {
  if (source[0] && isUpper(source[0])) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Convert a path segment or word to PascalCase entity name.
 *   "pets"        → "Pet"
 *   "user_groups" → "UserGroup"
 *   "v2"          → "V2"  (caller decides whether to drop)
 */
export function toEntityName(segment: string): string {
  const singular = singularize(segment);
  return singular
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
