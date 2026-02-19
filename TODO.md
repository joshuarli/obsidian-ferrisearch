## implement phrase queries

tantivy supports phrase queries

Currently with "foo bar", split_whitespace() gives ["foo", "bar"], each
becomes a Must clause — so it's an AND: documents must contain both "foo"
AND "bar" somewhere, in any order, any distance, any field. It's not a
phrase match at all. "bar foo" would return the same results.
