use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, RegexQuery, TermQuery};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, Searcher, Term};

use crate::index::{IndexError, IndexManager};
use crate::types::{SearchOptions, SearchResult};

impl IndexManager {
    /// Search the index with the given query string and options.
    pub fn search(
        &self,
        query_str: &str,
        options: &SearchOptions,
    ) -> Result<Vec<SearchResult>, IndexError> {
        let searcher = self.reader()?.searcher();

        let query_str = query_str.trim();
        if query_str.is_empty() {
            return Ok(Vec::new());
        }

        let fuzziness: f32 = match options.fuzziness.as_str() {
            "0" => 0.0,
            "1" => 0.1,
            _ => 0.2,
        };

        let terms: Vec<&str> = query_str.split_whitespace().collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }

        // For each query term, build an OR across all text fields.
        // Then combine all term queries with AND (every term must match somewhere).
        let must_clauses: Vec<(Occur, Box<dyn Query>)> = terms
            .iter()
            .map(|term_str| {
                let lower = term_str.to_lowercase();
                let field_queries: Vec<(Occur, Box<dyn Query>)> = self
                    .fields
                    .text_fields()
                    .iter()
                    .flat_map(|(name, field)| {
                        let boost = options.field_boosts.for_field(name);
                        let term = Term::from_field_text(*field, &lower);
                        let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(3);

                        // Exact match
                        queries.push((
                            Occur::Should,
                            Box::new(BoostQuery::new(
                                Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqs)),
                                boost,
                            )),
                        ));

                        // Prefix match
                        if lower.len() >= options.prefix_length {
                            if let Ok(rq) =
                                RegexQuery::from_pattern(&format!("{}.*", regex::escape(&lower)), *field)
                            {
                                queries.push((
                                    Occur::Should,
                                    Box::new(BoostQuery::new(Box::new(rq), boost * 0.8)),
                                ));
                            }
                        }

                        // Fuzzy match
                        if fuzziness > 0.0 {
                            let dist = fuzzy_distance(&lower, fuzziness);
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

                (Occur::Must, Box::new(BooleanQuery::new(field_queries)) as Box<dyn Query>)
            })
            .collect();

        let mut final_query: Box<dyn Query> = Box::new(BooleanQuery::new(must_clauses));

        // Optional single-file filter
        if let Some(ref file_path) = options.single_file_path {
            let path_term = Term::from_field_text(self.fields.path, file_path);
            final_query = Box::new(BooleanQuery::new(vec![
                (Occur::Must, final_query),
                (
                    Occur::Must,
                    Box::new(TermQuery::new(path_term, IndexRecordOption::Basic)),
                ),
            ]));
        }

        let results = searcher.search(&*final_query, &TopDocs::with_limit(options.limit))?;

        // Recency boost (applied post-hoc)
        let recency_decay = match options.recency_boost.as_str() {
            "1" => Some(-3.0_f64),  // Day
            "2" => Some(-0.3_f64),  // Week
            "3" => Some(-0.1_f64),  // Month
            _ => None,
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        let mut search_results: Vec<SearchResult> = results
            .into_iter()
            .filter_map(|(score, addr)| {
                let mut r = self.doc_to_result(&searcher, addr, score as f64, &terms).ok()?;
                if let Some(decay) = recency_decay {
                    let days = (now - r.mtime as f64) / (24.0 * 3_600_000.0);
                    r.score *= 1.0 + (decay * days / 1000.0).exp();
                }
                Some(r)
            })
            .collect();

        if recency_decay.is_some() {
            search_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        }

        Ok(search_results)
    }

    fn doc_to_result(
        &self,
        searcher: &Searcher,
        addr: DocAddress,
        score: f64,
        query_terms: &[&str],
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
            .map(|arr| arr.into_iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        Ok(SearchResult {
            path: text(f.path),
            basename: text(f.basename),
            display_title: text(f.display_title),
            content: text(f.content),
            mtime: doc.get_first(f.mtime).and_then(|v| v.as_u64()).unwrap_or(0),
            score,
            matched_terms: query_terms.iter().map(|t| t.to_lowercase()).collect(),
            tags,
        })
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

    fn make_doc(path: &str, basename: &str, content: &str) -> DocumentInput {
        DocumentInput {
            path: path.into(),
            basename: basename.into(),
            display_title: String::new(),
            aliases: String::new(),
            content: content.into(),
            headings1: String::new(),
            headings2: String::new(),
            headings3: String::new(),
            tags: vec![],
            unmarked_tags: vec![],
            mtime: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
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
            make_doc("notes/hello.md", "hello", "Hello world, this is a test document"),
            make_doc("notes/other.md", "other", "Completely unrelated content here"),
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
        assert!(mgr.search("", &SearchOptions::default()).unwrap().is_empty());
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
    fn basename_boost() {
        let mgr = setup_index(vec![
            make_doc("notes/rust.md", "rust", "This note is about python programming"),
            make_doc("notes/python.md", "python", "This note mentions rust once"),
        ]);
        let results = mgr.search("rust", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "notes/rust.md");
    }

    #[test]
    fn fuzzy_search() {
        let mgr = setup_index(vec![make_doc(
            "a.md", "a", "The restaurant serves excellent cuisine",
        )]);
        let opts = SearchOptions { fuzziness: "2".into(), ..Default::default() };
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
        doc.mtime = 12345;
        let mgr = setup_index(vec![doc]);

        let r = &mgr.search("hello", &SearchOptions::default()).unwrap()[0];
        assert_eq!(r.path, "notes/test.md");
        assert_eq!(r.basename, "test");
        assert_eq!(r.display_title, "Test Note");
        assert_eq!(r.content, "Hello world content");
        assert_eq!(r.mtime, 12345);
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
        assert!(mgr.search("   \t  ", &SearchOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn fuzziness_zero_no_fuzzy() {
        let mgr = setup_index(vec![make_doc(
            "a.md", "a", "The restaurant serves excellent cuisine",
        )]);
        let opts = SearchOptions { fuzziness: "0".into(), ..Default::default() };
        assert!(mgr.search("restaurnt", &opts).unwrap().is_empty());
    }

    #[test]
    fn recency_boost_day() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut recent = make_doc("recent.md", "recent", "hello world test");
        recent.mtime = now;
        let mut old = make_doc("old.md", "old", "hello world test");
        old.mtime = now - 30 * 24 * 3_600_000;

        let mgr = setup_index(vec![recent, old]);
        let opts = SearchOptions { recency_boost: "1".into(), ..Default::default() };
        let results = mgr.search("hello", &opts).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(results[0].path, "recent.md");
    }

    #[test]
    fn matched_terms_lowercased() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "Hello World content")]);
        let results = mgr.search("Hello World", &SearchOptions::default()).unwrap();
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
        assert_eq!(b.for_field("headings1"), 6.0);
        assert_eq!(b.for_field("headings2"), 5.0);
        assert_eq!(b.for_field("headings3"), 4.0);
        assert_eq!(b.for_field("tags_text"), 2.0);
        assert_eq!(b.for_field("unmarked_tags"), 2.0);
        assert_eq!(b.for_field("nonexistent"), 1.0);
    }

    #[test]
    fn headings_search() {
        let mut doc = make_doc("a.md", "a", "body text");
        doc.headings1 = "Important Heading".into();
        let mgr = setup_index(vec![doc]);
        let results = mgr.search("important", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn aliases_search() {
        let mut doc = make_doc("a.md", "a", "body text");
        doc.aliases = "nickname shortname".into();
        let mgr = setup_index(vec![doc]);
        assert!(!mgr.search("nickname", &SearchOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn tags_text_search() {
        let mut doc = make_doc("a.md", "a", "body text");
        doc.tags = vec!["#programming".into(), "#rust".into()];
        let mgr = setup_index(vec![doc]);
        assert!(!mgr.search("programming", &SearchOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn unmarked_tags_search() {
        let mut doc = make_doc("a.md", "a", "body text");
        doc.unmarked_tags = vec!["coding".into()];
        let mgr = setup_index(vec![doc]);
        assert!(!mgr.search("coding", &SearchOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn limit_results() {
        let docs: Vec<DocumentInput> = (0..10)
            .map(|i| make_doc(&format!("{i}.md"), &format!("{i}"), "common search term"))
            .collect();
        let mgr = setup_index(docs);
        let opts = SearchOptions { limit: 3, ..Default::default() };
        assert!(mgr.search("common", &opts).unwrap().len() <= 3);
    }

    #[test]
    fn prefix_search() {
        let mgr = setup_index(vec![make_doc(
            "a.md", "a", "internationalization is important",
        )]);
        let opts = SearchOptions { prefix_length: 1, ..Default::default() };
        assert!(!mgr.search("intern", &opts).unwrap().is_empty());
    }

    #[test]
    fn no_results_for_nonexistent() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "hello world")]);
        assert!(mgr.search("xyzzynonexistent", &SearchOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn single_char_query() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "x marks the spot")]);
        assert!(!mgr.search("x", &SearchOptions::default()).unwrap().is_empty());
    }
}
