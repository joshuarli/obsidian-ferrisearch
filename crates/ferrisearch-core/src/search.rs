use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, PhrasePrefixQuery, PhraseQuery, Query,
    TermQuery,
};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, Searcher, Term};

use unicode_normalization::UnicodeNormalization;

use crate::index::{IndexError, IndexManager};
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

/// If exact+prefix returns fewer than this many results, retry with fuzzy.
const FUZZY_RESULT_THRESHOLD: usize = 5;

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

        let fuzziness: f32 = match options.fuzziness.as_str() {
            "0" => 0.0,
            "1" => 0.1,
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

        // Pre-compile the match extractor once for all results
        let matcher = MatchExtractor::new(&all_words, self.ignore_diacritics);

        // Phase 1: exact + prefix only (no fuzzy)
        let query = self.build_search_query(&parsed, options, 0.0);
        let mut results = searcher.search(&*query, &TopDocs::with_limit(options.limit as usize))?;

        // Phase 2: if too few results and fuzzy is enabled, retry with fuzzy on content
        if results.len() < FUZZY_RESULT_THRESHOLD && fuzziness > 0.0 && !parsed.terms.is_empty() {
            let query = self.build_search_query(&parsed, options, fuzziness);
            results = searcher.search(&*query, &TopDocs::with_limit(options.limit as usize))?;
        }

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
                    .doc_to_result(&searcher, addr, score as f64, &all_words, &matcher)
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
    fn build_search_query(
        &self,
        parsed: &ParsedQuery,
        options: &SearchOptions,
        fuzziness: f32,
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
                        if *name != "directory" && lower.len() >= options.prefix_length as usize {
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
        query_words: &[String],
        matcher: &MatchExtractor,
    ) -> Result<SearchResult, IndexError> {
        let doc: tantivy::TantivyDocument = searcher.doc(addr)?;
        let f = &self.fields;

        let text = |field| -> String {
            doc.get_first(field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };

        let tags = doc
            .get_first(f.tags_stored)
            .and_then(|v| v.as_object())
            .and_then(|obj| obj.into_iter().find(|(k, _)| *k == "tags"))
            .and_then(|(_, v)| v.as_array())
            .map(|arr| {
                arr.into_iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let content = text(f.content);
        let matches = matcher.find_matches(&content);

        Ok(SearchResult {
            path: text(f.path),
            basename: text(f.basename),
            display_title: text(f.display_title),
            content,
            mtime: doc.get_first(f.mtime).and_then(|v| v.as_u64()).unwrap_or(0) as f64,
            score,
            matched_terms: query_words.to_vec(),
            tags,
            matches,
        })
    }
}

/// Maximum number of matches to extract per document.
const MAX_MATCHES: usize = 100;

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

        let (search_text, byte_map) = if needs_diacritics {
            let (stripped, map) = strip_diacritics_with_mapping(content);
            (stripped, Some(map))
        } else {
            (String::new(), None)
        };
        let search_content: &str = if needs_diacritics {
            &search_text
        } else {
            content
        };

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
