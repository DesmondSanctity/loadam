/**
 * Tokenize a shell-style curl command line, respecting quotes and line
 * continuations. Not a full shell parser — handles the subset that real
 * "Copy as curl" outputs produce from browsers and Postman.
 */
export function tokenizeCurl(input: string): string[] {
  // Collapse line continuations: trailing backslash + newline → space.
  const collapsed = input.replace(/\\\r?\n/g, " ").trim();

  const tokens: string[] = [];
  let buf = "";
  let i = 0;
  let quote: '"' | "'" | null = null;

  while (i < collapsed.length) {
    const ch = collapsed[i]!;

    if (quote) {
      if (ch === "\\" && quote === '"' && collapsed[i + 1] !== undefined) {
        // double-quote allows escapes
        buf += collapsed[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i++;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "\\" && collapsed[i + 1] !== undefined) {
      buf += collapsed[i + 1];
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.length > 0) tokens.push(buf);

  if (quote) {
    throw new Error(`Unterminated ${quote} quote in curl command`);
  }
  return tokens;
}
