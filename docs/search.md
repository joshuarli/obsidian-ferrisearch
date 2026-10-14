# Search

The Rust query builder searches four fields: the displayed title, the note's directory, its text, and its headings. The displayed title is the first H1 heading or the filename when the note has no H1. Heading text includes H1 through H3.

The query builder does not search aliases or tag metadata as fields. Inline tag text can match in the note text. A matching tag in Obsidian metadata can also boost a result that matched the text query.

## Query syntax

- Separate words to require each word in the result.
- Put words in double quotes to require consecutive terms in one field.
- Combine a text query with `path:fragment` to keep results whose vault-relative path contains `fragment`.
- Combine a text query with `-path:fragment` to remove results whose path contains `fragment`.
- Add `ext:md` to keep results whose file extension starts with `md`.
- Add `-ext:pdf` to remove results whose file extension starts with `pdf`.
- Add `-word` to a text query to exclude results whose note text contains `word`.

Path matching ignores case. Prefix searches apply to the title, text, and headings. The search does not use Obsidian's search operators.

Query text uses the same tokenizer as indexed fields. Punctuation and symbols split unquoted terms, so `foo-bar` requires both `foo` and `bar`, and `C++` searches for `c`.

Quoted text keeps one token per tokenizer position, in order, and requires adjacent positions. For example, `"foo-bar baz"` matches `foo bar baz` but not `foo extra bar baz`.

## Fuzziness and ranking

Fuzziness `0` searches exact terms and prefixes. For unquoted terms, levels `1` and `2` add fuzzy matches if exact and prefix searches return fewer than five results. Their fuzzy term queries search note text. Level `3` searches fuzzy matches across the four fields and skips exact and prefix queries for unquoted terms. Terms shorter than four bytes have no fuzzy edit distance.

The default field boosts are 10 for displayed titles, 7 for directories, 5 for headings, and 1 for note text. The settings UI exposes alias and tag weight controls. The query builder does not search those fields, so the controls do not affect core query scores. Tag matches use a separate post-search boost.

The search engine applies query filters and ranking adjustments before the result limit.

The default tokenizer splits on Unicode punctuation, symbols, separators, and control characters. It emits camel-case sub-terms at the same position as the full token. Quoted phrases can therefore match across camel-case boundaries. Diacritics are ignored by default for both indexing and queries. Changing that setting requires a restart.

The query builder is in [`search.rs`](../crates/ferrisearch-core/src/search.rs). The searched fields are defined in [`schema.rs`](../crates/ferrisearch-core/src/schema.rs), and the tokenizer is in [`tokenizer.rs`](../crates/ferrisearch-core/src/tokenizer.rs).
