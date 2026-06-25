const SNIPPET_MAX = 200;

/** Named entities the comment sanitizer (renderCommentBody) emits. Numeric
 *  entities are decoded separately. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Replace block tags with a space so block boundaries don't glue words together
 *  (`<p>a</p><p>b</p>` → `a b`, not `ab`); inline tags are removed *without* a
 *  space so inline formatting next to punctuation stays tight (`<strong>TLS</strong>?`
 *  → `TLS?`, not `TLS ?` — collapseWhitespace can't undo a space before punctuation).
 *  Whitespace is collapsed afterwards. */
function stripTags(html: string): string {
  const blockTags =
    /(<\/?(?:p|div|blockquote|h[1-6]|ul|ol|li|pre|table|tr|td|th|thead|tbody|tfoot)[^>]*>)/gi;
  return html.replace(blockTags, " ").replace(/<[^>]+>/g, "");
}

/** Decode the `NAMED_ENTITIES` set plus numeric `&#NN;` / `&#xNN;`. Runs after tag
 *  stripping so a decoded `<` can't masquerade as a tag. Unknown entities and
 *  out-of-range code points are left verbatim. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const cp =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) && cp >= 1 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Truncate to at most `max` graphemes (never mid-grapheme), appending an
 *  ellipsis only when the text was actually longer. */
function truncateGraphemes(text: string, max: number): string {
  const graphemes: string[] = [];
  for (const { segment } of graphemeSegmenter.segment(text)) {
    graphemes.push(segment);
    if (graphemes.length > max) break; // one past the limit is enough to know it's truncated
  }
  if (graphemes.length <= max) return text;
  return `${graphemes.slice(0, max).join("")}…`;
}

/** Derive a clean one-line preview from sanitized comment HTML: strip markup,
 *  decode entities, collapse whitespace, grapheme-safe truncate. */
export function snippetFromHtml(html: string, max = SNIPPET_MAX): string {
  const text = collapseWhitespace(decodeEntities(stripTags(html)));
  return truncateGraphemes(text, max);
}
