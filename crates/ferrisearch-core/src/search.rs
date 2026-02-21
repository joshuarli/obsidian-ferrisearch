use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, PhrasePrefixQuery, PhraseQuery, Query,
    TermQuery,
};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, Searcher, Term};

use unicode_normalization::UnicodeNormalization;

use crate::index::{IndexError, IndexManager};
use crate::schema::{doc_text, extract_tags};
use crate::types::{MatchInfo, SearchOptions, SearchResult};

/// Parsed query: individual terms and quoted phrases.
struct ParsedQuery {
    terms: Vec<String>,
    phrases: Vec<Vec<String>>,
}

/// Parse a query string into individual terms and quoted phrases.
/// `"foo bar" baz` → phrases: \[\["foo", "bar"\]\], terms: \["baz"\]
/// Single-word phrases are promoted to terms. Unclosed quotes are treated as terms.
fn parse_query(input: &str) -> ParsedQuery {
    let mut terms = Vec::new();
    let mut phrases = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }

        if ch == '"' {
            chars.next(); // consume opening quote
            let mut phrase_text = String::new();
            let mut closed = false;

            for c in chars.by_ref() {
                if c == '"' {
                    closed = true;
                    break;
                }
                phrase_text.push(c);
            }

            if closed {
                let words: Vec<String> = phrase_text
                    .split_whitespace()
                    .map(|w| w.to_lowercase())
                    .collect();
                match words.len() {
                    0 => {}
                    1 => terms.push(words.into_iter().next().unwrap()),
                    _ => phrases.push(words),
                }
            } else {
                // Unclosed quote: treat contents as individual terms
                for word in phrase_text.split_whitespace() {
                    terms.push(word.to_lowercase());
                }
            }
        } else {
            let mut word = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() || c == '"' {
                    break;
                }
                word.push(c);
                chars.next();
            }
            if !word.is_empty() {
                terms.push(word.to_lowercase());
            }
        }
    }

    ParsedQuery { terms, phrases }
}

impl IndexManager {
    /// Search the index with the given query string and options.
    /// Supports quoted phrases: `"quick brown"` requires adjacent terms.
    ///
    /// Uses two-phase search: first exact+prefix only (fast), then adds fuzzy
    /// on content if too few results are found.
    pub fn search(
        &self,
        query_str: &str,
        options: &SearchOptions,
    ) -> Result<Vec<SearchResult>, IndexError> {
        let searcher = self.reader.searcher();

        let query_str = query_str.trim();
        if query_str.is_empty() {
            return Ok(Vec::new());
        }

        let fuzzy_only = options.fuzziness == "3";
        let fuzziness: f32 = match options.fuzziness.as_str() {
            "0" => 0.0,
            "1" => 0.1,
            "3" => 0.2,
            _ => 0.2,
        };

        let parsed = parse_query(query_str);
        if parsed.terms.is_empty() && parsed.phrases.is_empty() {
            return Ok(Vec::new());
        }

        // All individual words (terms + phrase words) for matched_terms / highlighting
        let all_words: Vec<String> = parsed
            .terms
            .iter()
            .chain(parsed.phrases.iter().flatten())
            .cloned()
            .collect();

        // Pre-compile the match extractor for exact term highlighting
        let matcher = MatchExtractor::new(&all_words, self.ignore_diacritics);
        let mp = MatchParams {
            query_words: &all_words,
            matcher: &matcher,
            fuzziness,
            fuzzy_only,
        };

        let results = if fuzzy_only {
            // Fuzzy-only mode: skip exact+prefix, go straight to fuzzy on all fields
            let query = self.build_search_query(&parsed, options, fuzziness, true);
            searcher.search(&*query, &TopDocs::with_limit(options.limit as usize))?
        } else {
            // Phase 1: exact + prefix only (no fuzzy)
            let query = self.build_search_query(&parsed, options, 0.0, false);
            let mut results =
                searcher.search(&*query, &TopDocs::with_limit(options.limit as usize))?;

            // Phase 2: if there's room for more results and fuzzy is enabled, retry with fuzzy
            let fuzzy_threshold = (options.limit as usize).saturating_sub(5);
            if results.len() < fuzzy_threshold && fuzziness > 0.0 && !parsed.terms.is_empty() {
                let query = self.build_search_query(&parsed, options, fuzziness, false);
                results = searcher.search(&*query, &TopDocs::with_limit(options.limit as usize))?;
            }
            results
        };

        // Recency boost (applied post-hoc)
        let recency_decay = match options.recency_boost.as_str() {
            "1" => Some(-3.0_f64), // Day
            "2" => Some(-0.3_f64), // Week
            "3" => Some(-0.1_f64), // Month
            _ => None,
        };
        let now = now_epoch_millis();

        let mut search_results: Vec<SearchResult> = results
            .into_iter()
            .filter_map(|(score, addr)| {
                let mut r = self
                    .doc_to_result(&searcher, addr, score as f64, &mp)
                    .ok()?;
                if let Some(decay) = recency_decay {
                    let days = (now - r.mtime) / (24.0 * 3_600_000.0);
                    r.score *= 1.0 + (decay * days / 1000.0).exp();
                }
                Some(r)
            })
            .collect();

        if recency_decay.is_some() {
            search_results.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        Ok(search_results)
    }

    /// Build the complete search query. When `fuzziness > 0`, fuzzy sub-queries
    /// are added on the content field only (typos in prose, not titles/paths).
    /// When `fuzzy_only` is true, only fuzzy queries are emitted (on all fields).
    fn build_search_query(
        &self,
        parsed: &ParsedQuery,
        options: &SearchOptions,
        fuzziness: f32,
        fuzzy_only: bool,
    ) -> Box<dyn Query> {
        // For each term: exact on all fields, prefix on non-directory, fuzzy on content
        let mut must_clauses: Vec<(Occur, Box<dyn Query>)> = parsed
            .terms
            .iter()
            .map(|lower| {
                let field_queries: Vec<(Occur, Box<dyn Query>)> = self
                    .fields
                    .text_fields()
                    .iter()
                    .flat_map(|(name, field)| {
                        let boost = options.field_boosts.for_field(name);
                        let term = Term::from_field_text(*field, lower);
                        let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(3);

                        if fuzzy_only {
                            // Fuzzy-only mode: only fuzzy queries, on all searched fields.
                            // No exact or prefix queries — only typo-tolerant matching.
                            let dist = fuzzy_distance(lower, fuzziness);
                            if dist > 0 {
                                queries.push((
                                    Occur::Should,
                                    Box::new(BoostQuery::new(
                                        Box::new(FuzzyTermQuery::new(term, dist, true)),
                                        boost,
                                    )),
                                ));
                            }
                        } else {
                            // Exact match (all fields)
                            queries.push((
                                Occur::Should,
                                Box::new(BoostQuery::new(
                                    Box::new(TermQuery::new(
                                        term.clone(),
                                        IndexRecordOption::WithFreqs,
                                    )),
                                    boost,
                                )),
                            ));

                            // Prefix match (skip directory — exact is sufficient for paths)
                            if *name != "directory" && lower.len() >= options.prefix_length as usize
                            {
                                queries.push((
                                    Occur::Should,
                                    Box::new(BoostQuery::new(
                                        Box::new(PhrasePrefixQuery::new(vec![term.clone()])),
                                        boost * 0.8,
                                    )),
                                ));
                            }

                            // Fuzzy match (content only)
                            if *name == "content" && fuzziness > 0.0 {
                                let dist = fuzzy_distance(lower, fuzziness);
                                if dist > 0 {
                                    queries.push((
                                        Occur::Should,
                                        Box::new(BoostQuery::new(
                                            Box::new(FuzzyTermQuery::new(term, dist, true)),
                                            boost * 0.6,
                                        )),
                                    ));
                                }
                            }
                        }

                        queries
                    })
                    .collect();

                (
                    Occur::Must,
                    Box::new(BooleanQuery::new(field_queries)) as Box<dyn Query>,
                )
            })
            .collect();

        // Phrase queries: each phrase must match in at least one field
        for phrase_words in &parsed.phrases {
            let field_queries: Vec<(Occur, Box<dyn Query>)> = self
                .fields
                .text_fields()
                .iter()
                .map(|(name, field)| {
                    let boost = options.field_boosts.for_field(name);
                    let terms: Vec<Term> = phrase_words
                        .iter()
                        .map(|w| Term::from_field_text(*field, w))
                        .collect();
                    (
                        Occur::Should,
                        Box::new(BoostQuery::new(Box::new(PhraseQuery::new(terms)), boost))
                            as Box<dyn Query>,
                    )
                })
                .collect();

            must_clauses.push((
                Occur::Must,
                Box::new(BooleanQuery::new(field_queries)) as Box<dyn Query>,
            ));
        }

        let mut query: Box<dyn Query> = Box::new(BooleanQuery::new(must_clauses));

        // Optional single-file filter
        if let Some(ref file_path) = options.single_file_path {
            let path_term = Term::from_field_text(self.fields.path, file_path);
            query = Box::new(BooleanQuery::new(vec![
                (Occur::Must, query),
                (
                    Occur::Must,
                    Box::new(TermQuery::new(path_term, IndexRecordOption::Basic)),
                ),
            ]));
        }

        query
    }

    fn doc_to_result(
        &self,
        searcher: &Searcher,
        addr: DocAddress,
        score: f64,
        mp: &MatchParams,
    ) -> Result<SearchResult, IndexError> {
        let doc: tantivy::TantivyDocument = searcher.doc(addr)?;
        let f = &self.fields;

        let content = doc_text(&doc, f.content);
        let matches = if mp.fuzzy_only {
            // Fuzzy-only: only typo-variant matches (distance > 0), full distance
            find_fuzzy_matches(
                &content,
                mp.query_words,
                mp.fuzziness,
                self.ignore_diacritics,
            )
        } else {
            let mut m = mp.matcher.find_matches(&content);
            if mp.fuzziness > 0.0 {
                // Also highlight close typos (cap at distance 1 to avoid false positives
                // like "Wonder" matching "powder"). The Tantivy query uses the full
                // distance to FIND documents; this only affects which words get highlighted.
                let fuzzy = find_fuzzy_matches(
                    &content,
                    mp.query_words,
                    MATCH_FUZZINESS,
                    self.ignore_diacritics,
                );
                m.extend(fuzzy);
                m.sort_by_key(|mi| mi.offset);
            }
            m
        };

        Ok(SearchResult {
            path: doc_text(&doc, f.path),
            basename: doc_text(&doc, f.basename),
            display_title: doc_text(&doc, f.display_title),
            content,
            mtime: doc.get_first(f.mtime).and_then(|v| v.as_u64()).unwrap_or(0) as f64,
            score,
            matched_terms: mp.query_words.to_vec(),
            tags: extract_tags(&doc, f.tags_stored),
            matches,
        })
    }
}

/// Parameters for extracting match highlights from document content.
struct MatchParams<'a> {
    query_words: &'a [String],
    matcher: &'a MatchExtractor,
    fuzziness: f32,
    fuzzy_only: bool,
}

/// Maximum number of matches to extract per document.
const MAX_MATCHES: usize = 100;

/// Fuzziness used for match highlighting in normal fuzzy modes (fuzziness "1"/"2").
/// Capped at 0.1 (→ max edit distance 1) to only highlight close typos like "pwoder",
/// not distant words like "Wonder". The Tantivy search query uses the full fuzziness
/// to find documents; this only limits which content words get highlighted.
const MATCH_FUZZINESS: f32 = 0.1;

/// Pre-compiled match extractor. Built once per search, reused across all results.
struct MatchExtractor {
    re: Option<regex::Regex>,
    ignore_diacritics: bool,
}

impl MatchExtractor {
    fn new(terms: &[String], ignore_diacritics: bool) -> Self {
        if terms.is_empty() {
            return Self {
                re: None,
                ignore_diacritics,
            };
        }

        // Sort by length descending and dedup (longer matches take priority)
        let mut sorted: Vec<&str> = terms.iter().map(|s| s.as_str()).collect();
        sorted.sort_by_key(|b| std::cmp::Reverse(b.len()));
        sorted.dedup();

        // Simple case-insensitive alternation — no \b needed for global find-all
        let pattern = sorted
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join("|");

        let re = regex::Regex::new(&format!("(?i){}", pattern)).ok();
        Self {
            re,
            ignore_diacritics,
        }
    }

    fn find_matches(&self, content: &str) -> Vec<MatchInfo> {
        let re = match self.re.as_ref() {
            Some(r) => r,
            None => return Vec::new(),
        };

        if content.is_empty() {
            return Vec::new();
        }

        // Fast path: skip diacritics stripping if content is ASCII
        let needs_diacritics = self.ignore_diacritics && !content.is_ascii();

        let (stripped, byte_map) = if needs_diacritics {
            let (s, m) = strip_diacritics_with_mapping(content);
            (Some(s), Some(m))
        } else {
            (None, None)
        };
        let search_content = stripped.as_deref().unwrap_or(content);

        let mut matches = Vec::new();
        let mut utf16_pos: u32 = 0;
        let mut last_orig_byte: usize = 0;

        for m in re.find_iter(search_content) {
            if matches.len() >= MAX_MATCHES {
                break;
            }

            // Map byte offsets back to original content positions
            let (orig_start, orig_end) = if let Some(ref map) = byte_map {
                let start = map[m.start()];
                let end = if m.end() < map.len() {
                    map[m.end()]
                } else {
                    content.len()
                };
                (start, end)
            } else {
                (m.start(), m.end())
            };

            // Advance UTF-16 position counter through original content
            utf16_pos += content[last_orig_byte..orig_start]
                .chars()
                .map(|c| c.len_utf16() as u32)
                .sum::<u32>();
            last_orig_byte = orig_start;

            // Extract matched text from original content (preserves case and diacritics)
            let match_text = content[orig_start..orig_end].trim();

            if !match_text.is_empty() {
                matches.push(MatchInfo {
                    match_text: match_text.to_string(),
                    offset: utf16_pos,
                });
            }
        }

        matches
    }
}

/// Strip diacritics from text and return a byte offset mapping.
/// `byte_map[i]` = the byte position in the original text corresponding to
/// byte position `i` in the stripped text.
fn strip_diacritics_with_mapping(text: &str) -> (String, Vec<usize>) {
    let mut result = String::new();
    let mut byte_map: Vec<usize> = Vec::new();

    for (orig_start, orig_char) in text.char_indices() {
        // NFD decompose this character, then filter combining marks
        for nfd_char in orig_char.nfd() {
            if unicode_normalization::char::is_combining_mark(nfd_char) {
                continue;
            }
            // Each byte of this base character maps back to the original character
            for _ in 0..nfd_char.len_utf8() {
                byte_map.push(orig_start);
            }
            result.push(nfd_char);
        }
    }

    (result, byte_map)
}

/// Optimal String Alignment distance (Damerau-Levenshtein variant).
/// Adjacent transpositions count as 1 edit, matching Tantivy's `transposition_cost_one=true`.
#[allow(clippy::needless_range_loop)]
fn osa_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let n = a.len();
    let m = b.len();

    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }

    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in 0..=n {
        dp[i][0] = i;
    }
    for j in 0..=m {
        dp[0][j] = j;
    }

    for i in 1..=n {
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                dp[i][j] = dp[i][j].min(dp[i - 2][j - 2] + 1);
            }
        }
    }

    dp[n][m]
}

/// Scan content for words that are within fuzzy edit distance of the query terms
/// but NOT exact matches (distance > 0). Returns match positions for typo-variant words.
fn find_fuzzy_matches(
    content: &str,
    terms: &[String],
    fuzziness: f32,
    ignore_diacritics: bool,
) -> Vec<MatchInfo> {
    if terms.is_empty() || content.is_empty() {
        return Vec::new();
    }

    // Pre-compute max distances
    let term_dists: Vec<(&str, u8)> = terms
        .iter()
        .map(|t| (t.as_str(), fuzzy_distance(t, fuzziness)))
        .filter(|(_, d)| *d > 0)
        .collect();

    if term_dists.is_empty() {
        return Vec::new();
    }

    // Match word-like tokens (everything that's not a separator)
    let word_re = regex::Regex::new(r"[^\p{P}\p{Z}\p{Cc}\p{S}]+").unwrap();

    let needs_diacritics = ignore_diacritics && !content.is_ascii();
    let (stripped, byte_map) = if needs_diacritics {
        let (s, m) = strip_diacritics_with_mapping(content);
        (Some(s), Some(m))
    } else {
        (None, None)
    };
    let search_content = stripped.as_deref().unwrap_or(content);

    let mut matches = Vec::new();
    let mut utf16_pos: u32 = 0;
    let mut last_orig_byte: usize = 0;

    for word_match in word_re.find_iter(search_content) {
        if matches.len() >= MAX_MATCHES {
            break;
        }

        let word_lower = word_match.as_str().to_lowercase();

        // Check each query term for a fuzzy (non-exact) match
        let is_fuzzy_match = term_dists.iter().any(|(term, max_dist)| {
            let dist = osa_distance(&word_lower, term);
            dist > 0 && dist <= *max_dist as usize
        });

        if !is_fuzzy_match {
            continue;
        }

        // Map byte offsets back to original content
        let (orig_start, orig_end) = if let Some(ref map) = byte_map {
            let start = map[word_match.start()];
            let end = if word_match.end() < map.len() {
                map[word_match.end()]
            } else {
                content.len()
            };
            (start, end)
        } else {
            (word_match.start(), word_match.end())
        };

        utf16_pos += content[last_orig_byte..orig_start]
            .chars()
            .map(|c| c.len_utf16() as u32)
            .sum::<u32>();
        last_orig_byte = orig_start;

        let match_text = content[orig_start..orig_end].trim();
        if !match_text.is_empty() {
            matches.push(MatchInfo {
                match_text: match_text.to_string(),
                offset: utf16_pos,
            });
        }
    }

    matches
}

/// Current time as milliseconds since Unix epoch.
/// Uses `js_sys::Date::now()` on WASM (where `std::time::SystemTime` panics).
fn now_epoch_millis() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0)
    }
}

/// Determine fuzzy edit distance based on term length and fuzziness level.
fn fuzzy_distance(term: &str, fuzziness: f32) -> u8 {
    let len = term.len();
    if len <= 3 {
        0
    } else if len <= 5 {
        if fuzziness >= 0.1 { 1 } else { 0 }
    } else if fuzziness >= 0.2 {
        2
    } else if fuzziness >= 0.1 {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DocumentInput, FieldBoosts, IndexConfig, SearchOptions};

    fn make_doc(path: &str, title: &str, content: &str) -> DocumentInput {
        DocumentInput {
            path: path.into(),
            basename: title.into(),
            display_title: title.into(),
            aliases: String::new(),
            content: content.into(),
            headings: String::new(),
            tags: vec![],
            unmarked_tags: vec![],
            mtime: now_epoch_millis(),
        }
    }

    fn setup_index(docs: Vec<DocumentInput>) -> IndexManager {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_documents(&docs).unwrap();
        mgr.commit().unwrap();
        mgr
    }

    #[test]
    fn basic_search() {
        let mgr = setup_index(vec![
            make_doc(
                "notes/hello.md",
                "hello",
                "Hello world, this is a test document",
            ),
            make_doc(
                "notes/other.md",
                "other",
                "Completely unrelated content here",
            ),
        ]);
        let results = mgr.search("hello", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "notes/hello.md");
    }

    #[test]
    fn multi_term_search() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "The quick brown fox jumps over the lazy dog"),
            make_doc("b.md", "b", "The quick rabbit runs fast"),
        ]);
        let results = mgr.search("quick fox", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn empty_query() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "content")]);
        assert!(
            mgr.search("", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn single_file_filter() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "hello world"),
            make_doc("b.md", "b", "hello world"),
        ]);
        let opts = SearchOptions {
            single_file_path: Some("a.md".into()),
            ..Default::default()
        };
        let results = mgr.search("hello", &opts).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn display_title_boost() {
        let mgr = setup_index(vec![
            make_doc(
                "notes/rust.md",
                "rust",
                "This note is about python programming",
            ),
            make_doc("notes/python.md", "python", "This note mentions rust once"),
        ]);
        let results = mgr.search("rust", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "notes/rust.md");
    }

    #[test]
    fn fuzzy_search() {
        let mgr = setup_index(vec![make_doc(
            "a.md",
            "a",
            "The restaurant serves excellent cuisine",
        )]);
        let opts = SearchOptions {
            fuzziness: "2".into(),
            ..Default::default()
        };
        assert!(!mgr.search("restaurnt", &opts).unwrap().is_empty());
    }

    #[test]
    fn tags_in_result() {
        let mut doc = make_doc("a.md", "a", "content");
        doc.tags = vec!["#rust".into(), "#programming".into()];
        let mgr = setup_index(vec![doc]);
        let results = mgr.search("content", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].tags, vec!["#rust", "#programming"]);
    }

    #[test]
    fn search_returns_stored_fields() {
        let mut doc = make_doc("notes/test.md", "test", "Hello world content");
        doc.display_title = "Test Note".into();
        doc.mtime = 12345.0;
        let mgr = setup_index(vec![doc]);

        let r = &mgr.search("hello", &SearchOptions::default()).unwrap()[0];
        assert_eq!(r.path, "notes/test.md");
        assert_eq!(r.basename, "test");
        assert_eq!(r.display_title, "Test Note");
        assert_eq!(r.content, "Hello world content");
        assert_eq!(r.mtime, 12345.0);
    }

    #[test]
    fn fuzzy_distance_values() {
        assert_eq!(fuzzy_distance("ab", 0.2), 0);
        assert_eq!(fuzzy_distance("abc", 0.2), 0);
        assert_eq!(fuzzy_distance("abcd", 0.2), 1);
        assert_eq!(fuzzy_distance("abcd", 0.1), 1);
        assert_eq!(fuzzy_distance("abcde", 0.2), 1);
        assert_eq!(fuzzy_distance("abcde", 0.0), 0);
        assert_eq!(fuzzy_distance("abcdef", 0.2), 2);
        assert_eq!(fuzzy_distance("abcdef", 0.1), 1);
        assert_eq!(fuzzy_distance("abcdef", 0.0), 0);
    }

    #[test]
    fn whitespace_only_query() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "content")]);
        assert!(
            mgr.search("   \t  ", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn osa_distance_values() {
        assert_eq!(osa_distance("powder", "powder"), 0); // exact
        assert_eq!(osa_distance("powder", "pwoder"), 1); // transposition
        assert_eq!(osa_distance("powder", "powdr"), 1); // deletion
        assert_eq!(osa_distance("powder", "poweder"), 1); // insertion
        assert_eq!(osa_distance("powder", "pawder"), 1); // substitution
        assert_eq!(osa_distance("restaurant", "restaurnt"), 1); // deletion
        assert_eq!(osa_distance("", "abc"), 3);
        assert_eq!(osa_distance("abc", ""), 3);
        assert_eq!(osa_distance("", ""), 0);
    }

    #[test]
    fn fuzziness_zero_no_fuzzy() {
        let mgr = setup_index(vec![make_doc(
            "a.md",
            "a",
            "The restaurant serves excellent cuisine",
        )]);
        let opts = SearchOptions {
            fuzziness: "0".into(),
            ..Default::default()
        };
        assert!(mgr.search("restaurnt", &opts).unwrap().is_empty());
    }

    #[test]
    fn fuzziness2_finds_pwoder() {
        // fuzziness "2" (standard fuzzy) should find "pwoder" when searching "powder"
        let mgr = setup_index(vec![make_doc(
            "typo.md",
            "typo",
            "The pwoder is dry and needs mixing",
        )]);
        let opts = SearchOptions {
            fuzziness: "2".into(),
            ..Default::default()
        };
        let results = mgr.search("powder", &opts).unwrap();
        assert!(
            !results.is_empty(),
            "fuzziness=2 should find 'pwoder' when searching 'powder'"
        );
        assert_eq!(results[0].path, "typo.md");
        // Matches should include "pwoder" as a fuzzy match
        let match_texts: Vec<&str> = results[0]
            .matches
            .iter()
            .map(|m| m.match_text.as_str())
            .collect();
        assert!(
            match_texts.contains(&"pwoder"),
            "fuzziness=2 matches should include 'pwoder', got: {:?}",
            match_texts
        );
    }

    #[test]
    fn fuzziness2_matches_both_exact_and_fuzzy() {
        // With fuzziness "2", matches should include both exact ("powder") and close typos ("pwoder")
        // but NOT distant words like "Wonder" (distance 2) — match extraction caps at distance 1.
        let mgr = setup_index(vec![make_doc(
            "recipe.md",
            "recipe",
            "50g milk powder is key. This is where milk pwoder comes in. I wonder about this.",
        )]);
        let opts = SearchOptions {
            fuzziness: "2".into(),
            ..Default::default()
        };
        let results = mgr.search("powder", &opts).unwrap();
        assert!(!results.is_empty());
        let match_texts: Vec<&str> = results[0]
            .matches
            .iter()
            .map(|m| m.match_text.as_str())
            .collect();
        assert!(
            match_texts.contains(&"powder"),
            "should include exact match 'powder'"
        );
        assert!(
            match_texts.contains(&"pwoder"),
            "should include close typo 'pwoder' (distance 1), got: {:?}",
            match_texts
        );
        assert!(
            !match_texts.contains(&"wonder"),
            "should NOT include distant word 'wonder' (distance 2)"
        );
    }

    #[test]
    fn fuzzy_only_matches_typo() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "The restaurnt serves excellent cuisine"),
            make_doc("b.md", "b", "Something completely different here"),
        ]);
        let opts = SearchOptions {
            fuzziness: "3".into(),
            ..Default::default()
        };
        // "restaurant" should fuzzy-match the typo "restaurnt"
        let results = mgr.search("restaurant", &opts).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn fuzzy_only_finds_typo_in_mixed_doc() {
        // Document contains both "powder" (exact) and "pwoder" (typo).
        // Fuzzy-only should find the document and match only the typo, not the exact word.
        let mgr = setup_index(vec![make_doc(
            "recipe.md",
            "recipe",
            "50g milk powder is key. This is where milk pwoder comes in.",
        )]);
        let opts = SearchOptions {
            fuzziness: "3".into(),
            ..Default::default()
        };
        let results = mgr.search("powder", &opts).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "recipe.md");
        // Matches should point to "pwoder" (the typo), NOT "powder" (exact)
        let match_texts: Vec<&str> = results[0]
            .matches
            .iter()
            .map(|m| m.match_text.as_str())
            .collect();
        assert!(
            match_texts.contains(&"pwoder"),
            "should match the typo 'pwoder', got: {:?}",
            match_texts
        );
        assert!(
            !match_texts.contains(&"powder"),
            "should NOT match the exact word 'powder'"
        );
    }

    #[test]
    fn fuzzy_only_matches_both_docs() {
        let mgr = setup_index(vec![
            make_doc("exact.md", "exact", "The powder is dry"),
            make_doc("typo.md", "typo", "The pwoder is dry"),
        ]);
        let opts = SearchOptions {
            fuzziness: "3".into(),
            ..Default::default()
        };
        let results = mgr.search("powder", &opts).unwrap();
        // Both docs are found by FuzzyTermQuery (distance 0 and 1 both within dist 2)
        assert_eq!(results.len(), 2);
        // The typo doc should have a match for "pwoder"
        let typo_doc = results.iter().find(|r| r.path == "typo.md").unwrap();
        assert_eq!(typo_doc.matches[0].match_text, "pwoder");
        // The exact doc should have NO matches (exact is excluded from fuzzy match extraction)
        let exact_doc = results.iter().find(|r| r.path == "exact.md").unwrap();
        assert!(exact_doc.matches.is_empty());
    }

    #[test]
    fn fuzzy_only_skips_short_terms() {
        // With fuzzy-only, short terms (<=3 chars) get distance 0 and produce
        // no fuzzy queries, so they won't match anything.
        let mgr = setup_index(vec![make_doc("a.md", "a", "the fox is here")]);
        let opts = SearchOptions {
            fuzziness: "3".into(),
            ..Default::default()
        };
        // "fox" is 3 chars → fuzzy_distance returns 0 → no fuzzy query → no results
        assert!(mgr.search("fox", &opts).unwrap().is_empty());
    }

    #[test]
    fn recency_boost_day() {
        let now = now_epoch_millis();

        let mut recent = make_doc("recent.md", "recent", "hello world test");
        recent.mtime = now;
        let mut old = make_doc("old.md", "old", "hello world test");
        old.mtime = now - 30.0 * 24.0 * 3_600_000.0;

        let mgr = setup_index(vec![recent, old]);
        let opts = SearchOptions {
            recency_boost: "1".into(),
            ..Default::default()
        };
        let results = mgr.search("hello", &opts).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(results[0].path, "recent.md");
    }

    #[test]
    fn matched_terms_lowercased() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "Hello World content")]);
        let results = mgr
            .search("Hello World", &SearchOptions::default())
            .unwrap();
        assert!(!results.is_empty());
        assert!(results[0].matched_terms.contains(&"hello".into()));
        assert!(results[0].matched_terms.contains(&"world".into()));
    }

    #[test]
    fn field_boosts_for_field() {
        let b = FieldBoosts::default();
        assert_eq!(b.for_field("basename"), 10.0);
        assert_eq!(b.for_field("display_title"), 10.0);
        assert_eq!(b.for_field("aliases"), 10.0);
        assert_eq!(b.for_field("directory"), 7.0);
        assert_eq!(b.for_field("content"), 1.0);
        assert_eq!(b.for_field("headings"), 5.0);
        assert_eq!(b.for_field("tags_text"), 2.0);
        assert_eq!(b.for_field("unmarked_tags"), 2.0);
        assert_eq!(b.for_field("nonexistent"), 1.0);
    }

    #[test]
    fn headings_search() {
        let mut doc = make_doc("a.md", "a", "body text");
        doc.headings = "Important Heading".into();
        let mgr = setup_index(vec![doc]);
        let results = mgr.search("important", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn disabled_fields_not_searched() {
        // aliases, tags_text, and unmarked_tags are indexed but not in text_fields(),
        // so searching for their content alone should return no results.
        let mut doc = make_doc("a.md", "a", "body text");
        doc.aliases = "nickname".into();
        doc.tags = vec!["#programming".into()];
        doc.unmarked_tags = vec!["coding".into()];
        let mgr = setup_index(vec![doc]);
        assert!(
            mgr.search("nickname", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
        assert!(
            mgr.search("programming", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
        assert!(
            mgr.search("coding", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn limit_results() {
        let docs: Vec<DocumentInput> = (0..10)
            .map(|i| make_doc(&format!("{i}.md"), &format!("{i}"), "common search term"))
            .collect();
        let mgr = setup_index(docs);
        let opts = SearchOptions {
            limit: 3.0,
            ..Default::default()
        };
        assert!(mgr.search("common", &opts).unwrap().len() <= 3);
    }

    #[test]
    fn prefix_search() {
        let mgr = setup_index(vec![make_doc(
            "a.md",
            "a",
            "internationalization is important",
        )]);
        let opts = SearchOptions {
            prefix_length: 1.0,
            ..Default::default()
        };
        assert!(!mgr.search("intern", &opts).unwrap().is_empty());
    }

    #[test]
    fn no_results_for_nonexistent() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "hello world")]);
        assert!(
            mgr.search("xyzzynonexistent", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn single_char_query() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "x marks the spot")]);
        assert!(
            !mgr.search("x", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    // ── Phrase query tests ─────────────────────────────────────────────

    #[test]
    fn phrase_basic_match() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "the quick brown fox jumps"),
            make_doc("b.md", "b", "the brown quick fox jumps"),
        ]);
        let results = mgr
            .search("\"quick brown\"", &SearchOptions::default())
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn phrase_no_match_reversed() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "the brown quick fox")]);
        assert!(
            mgr.search("\"quick brown\"", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn phrase_no_match_non_adjacent() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "quick red brown fox")]);
        assert!(
            mgr.search("\"quick brown\"", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn phrase_with_extra_terms() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "the quick brown fox jumps over the lazy dog"),
            make_doc("b.md", "b", "the lazy dog sleeps all day"),
        ]);
        let results = mgr
            .search("\"quick brown\" lazy", &SearchOptions::default())
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn single_word_phrase_as_term() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "hello world")]);
        let results = mgr.search("\"hello\"", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn multiple_phrases() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "quick brown fox and lazy dog"),
            make_doc("b.md", "b", "quick brown fox and busy cat"),
        ]);
        let results = mgr
            .search("\"quick brown\" \"lazy dog\"", &SearchOptions::default())
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn empty_phrase_ignored() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "hello world")]);
        assert!(
            mgr.search("\"\"", &SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn unclosed_quote_as_terms() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "hello beautiful world")]);
        // Unclosed quote: words treated as individual terms (AND, not phrase)
        let results = mgr
            .search("\"hello world", &SearchOptions::default())
            .unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn phrase_in_headings() {
        let mut doc = make_doc("a.md", "a", "body text only");
        doc.headings = "quick brown fox".into();
        let mgr = setup_index(vec![doc]);
        let results = mgr
            .search("\"quick brown\"", &SearchOptions::default())
            .unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn phrase_across_camel_case_boundary() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "myVariable is great")]);
        // "variable is" matches because sub-token "variable" (pos 0) and "is" (pos 1)
        // are at consecutive positions
        let results = mgr
            .search("\"variable is\"", &SearchOptions::default())
            .unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn phrase_matched_terms_include_phrase_words() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "the quick brown fox")]);
        let results = mgr
            .search("\"quick brown\" fox", &SearchOptions::default())
            .unwrap();
        assert!(!results.is_empty());
        assert!(results[0].matched_terms.contains(&"quick".into()));
        assert!(results[0].matched_terms.contains(&"brown".into()));
        assert!(results[0].matched_terms.contains(&"fox".into()));
    }

    // ── Query parser tests ─────────────────────────────────────────────

    #[test]
    fn parse_query_simple_terms() {
        let p = parse_query("hello world");
        assert_eq!(p.terms, vec!["hello", "world"]);
        assert!(p.phrases.is_empty());
    }

    #[test]
    fn parse_query_single_phrase() {
        let p = parse_query("\"quick brown\"");
        assert!(p.terms.is_empty());
        assert_eq!(p.phrases, vec![vec!["quick", "brown"]]);
    }

    #[test]
    fn parse_query_phrase_and_terms() {
        let p = parse_query("hello \"quick brown\" world");
        assert_eq!(p.terms, vec!["hello", "world"]);
        assert_eq!(p.phrases, vec![vec!["quick", "brown"]]);
    }

    #[test]
    fn parse_query_single_word_phrase_promoted() {
        let p = parse_query("\"hello\"");
        assert_eq!(p.terms, vec!["hello"]);
        assert!(p.phrases.is_empty());
    }

    #[test]
    fn parse_query_empty_phrase_ignored() {
        let p = parse_query("\"\"");
        assert!(p.terms.is_empty());
        assert!(p.phrases.is_empty());
    }

    #[test]
    fn parse_query_unclosed_quote() {
        let p = parse_query("\"hello world");
        assert_eq!(p.terms, vec!["hello", "world"]);
        assert!(p.phrases.is_empty());
    }

    #[test]
    fn parse_query_multiple_phrases() {
        let p = parse_query("\"foo bar\" \"baz qux\"");
        assert!(p.terms.is_empty());
        assert_eq!(p.phrases, vec![vec!["foo", "bar"], vec!["baz", "qux"]]);
    }

    #[test]
    fn parse_query_lowercases() {
        let p = parse_query("Hello \"FOO Bar\"");
        assert_eq!(p.terms, vec!["hello"]);
        assert_eq!(p.phrases, vec![vec!["foo", "bar"]]);
    }

    // ── find_matches tests ────────────────────────────────────────────

    fn extract(content: &str, terms: &[String], ignore_diacritics: bool) -> Vec<MatchInfo> {
        MatchExtractor::new(terms, ignore_diacritics).find_matches(content)
    }

    #[test]
    fn find_matches_basic() {
        let matches = extract("hello world hello", &["hello".into()], false);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].match_text, "hello");
        assert_eq!(matches[0].offset, 0);
        assert_eq!(matches[1].match_text, "hello");
        assert_eq!(matches[1].offset, 12);
    }

    #[test]
    fn find_matches_case_insensitive() {
        let matches = extract("Hello WORLD", &["hello".into(), "world".into()], false);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].match_text, "Hello");
        assert_eq!(matches[1].match_text, "WORLD");
    }

    #[test]
    fn find_matches_cap_at_100() {
        let content = "word ".repeat(200);
        let matches = extract(&content, &["word".into()], false);
        assert_eq!(matches.len(), MAX_MATCHES);
    }

    #[test]
    fn find_matches_empty_terms() {
        let matches = extract("hello world", &[], false);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_matches_empty_content() {
        let matches = extract("", &["hello".into()], false);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_matches_no_match() {
        let matches = extract("hello world", &["xyz".into()], false);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_matches_diacritics() {
        let matches = extract("café résumé", &["cafe".into(), "resume".into()], true);
        assert_eq!(matches.len(), 2);
        // Original text preserved (with diacritics)
        assert_eq!(matches[0].match_text, "café");
        assert_eq!(matches[1].match_text, "résumé");
    }

    #[test]
    fn find_matches_ascii_skips_diacritics() {
        // ASCII content with ignore_diacritics=true should still work (fast path)
        let matches = extract("hello world", &["hello".into()], true);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].match_text, "hello");
    }

    #[test]
    fn find_matches_utf16_offsets() {
        // Each CJK character is 1 UTF-16 code unit but 3 UTF-8 bytes
        let matches = extract("世界hello", &["hello".into()], false);
        assert_eq!(matches.len(), 1);
        // "世界" = 2 chars, 2 UTF-16 code units
        assert_eq!(matches[0].offset, 2);
    }

    #[test]
    fn find_matches_emoji_utf16_offsets() {
        // 😀 is 4 UTF-8 bytes but 2 UTF-16 code units (surrogate pair)
        let matches = extract("😀hello", &["hello".into()], false);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].offset, 2); // surrogate pair = 2 UTF-16 code units
    }

    #[test]
    fn find_matches_multiple_terms() {
        let matches = extract(
            "the quick brown fox",
            &["quick".into(), "fox".into()],
            false,
        );
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].match_text, "quick");
        assert_eq!(matches[0].offset, 4);
        assert_eq!(matches[1].match_text, "fox");
        assert_eq!(matches[1].offset, 16);
    }

    #[test]
    fn search_returns_matches() {
        let mgr = setup_index(vec![make_doc(
            "a.md",
            "a",
            "Hello world, this is a test document",
        )]);
        let results = mgr.search("hello test", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert!(!results[0].matches.is_empty());
        let match_texts: Vec<&str> = results[0]
            .matches
            .iter()
            .map(|m| m.match_text.as_str())
            .collect();
        assert!(match_texts.contains(&"Hello"));
        assert!(match_texts.contains(&"test"));
    }
}
