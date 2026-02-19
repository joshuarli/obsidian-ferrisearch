use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, RegexQuery, TermQuery,
};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, ReloadPolicy, Searcher, Term};

use crate::index::{IndexError, IndexManager};
use crate::types::{SearchOptions, SearchResult};

impl IndexManager {
    /// Search the index with the given query string and options
    pub fn search(
        &self,
        query_str: &str,
        options: &SearchOptions,
    ) -> Result<Vec<SearchResult>, IndexError> {
        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let searcher = reader.searcher();

        let query_str = query_str.trim();
        if query_str.is_empty() {
            return Ok(Vec::new());
        }

        // Parse fuzziness setting
        let fuzziness_level: f32 = match options.fuzziness.as_str() {
            "0" => 0.0,
            "1" => 0.1,
            _ => 0.2,
        };

        // Tokenize query: split on whitespace
        let terms: Vec<&str> = query_str
            .split_whitespace()
            .filter(|t| !t.is_empty())
            .collect();

        if terms.is_empty() {
            return Ok(Vec::new());
        }

        // For each term, build a BooleanQuery (OR) across all text fields
        // Then combine all term queries with AND logic
        let mut term_queries: Vec<Box<dyn Query>> = Vec::new();

        for term_str in &terms {
            let term_lower = term_str.to_lowercase();
            let mut field_queries: Vec<(Occur, Box<dyn Query>)> = Vec::new();

            for (field_name, field) in self.fields.text_fields() {
                let boost = get_boost_for_field(field_name, &options.field_boosts);

                // Exact term query
                let exact_term = Term::from_field_text(field, &term_lower);
                let exact_query = TermQuery::new(exact_term.clone(), IndexRecordOption::WithFreqs);
                let boosted_exact: Box<dyn Query> =
                    Box::new(BoostQuery::new(Box::new(exact_query), boost));
                field_queries.push((Occur::Should, boosted_exact));

                // Prefix query (if term is long enough)
                if term_lower.len() >= options.prefix_length
                    && let Ok(regex_query) = RegexQuery::from_pattern(
                        &format!("{}.*", regex::escape(&term_lower)),
                        field,
                    )
                {
                    let boosted_prefix: Box<dyn Query> =
                        Box::new(BoostQuery::new(Box::new(regex_query), boost * 0.8));
                    field_queries.push((Occur::Should, boosted_prefix));
                }

                // Fuzzy query
                if fuzziness_level > 0.0 {
                    let distance = fuzzy_distance(&term_lower, fuzziness_level);
                    if distance > 0 {
                        let fuzzy_query = FuzzyTermQuery::new(exact_term, distance, true);
                        let boosted_fuzzy: Box<dyn Query> =
                            Box::new(BoostQuery::new(Box::new(fuzzy_query), boost * 0.6));
                        field_queries.push((Occur::Should, boosted_fuzzy));
                    }
                }
            }

            let combined_field_query = BooleanQuery::new(field_queries);
            term_queries.push(Box::new(combined_field_query));
        }

        // Combine all term queries with AND (all terms must match somewhere)
        let must_clauses: Vec<(Occur, Box<dyn Query>)> =
            term_queries.into_iter().map(|q| (Occur::Must, q)).collect();

        let mut final_query: Box<dyn Query> = Box::new(BooleanQuery::new(must_clauses));

        // If single file path filter, wrap with AND
        if let Some(ref file_path) = options.single_file_path {
            let path_term = Term::from_field_text(self.fields.path, file_path);
            let path_query = TermQuery::new(path_term, IndexRecordOption::Basic);
            let combined = BooleanQuery::new(vec![
                (Occur::Must, final_query),
                (Occur::Must, Box::new(path_query)),
            ]);
            final_query = Box::new(combined);
        }

        // Collect results - first get raw results, then apply recency boost post-hoc
        let top_docs_collector = TopDocs::with_limit(options.limit);
        let results = searcher.search(&*final_query, &top_docs_collector)?;

        // Convert to SearchResult structs, applying recency boost
        let recency_cutoff = match options.recency_boost.as_str() {
            "1" => Some(-3.0_f64), // Day
            "2" => Some(-0.3_f64), // Week
            "3" => Some(-0.1_f64), // Month
            _ => None,
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        let mut search_results = Vec::new();
        for (score, doc_address) in results {
            if let Ok(mut result) = self.doc_to_result(&searcher, doc_address, score as f64, &terms)
            {
                // Apply recency boost
                if let Some(cutoff) = recency_cutoff {
                    let days_elapsed = (now - result.mtime as f64) / (24.0 * 3_600_000.0);
                    result.score *= 1.0 + (cutoff * days_elapsed / 1000.0).exp();
                }
                search_results.push(result);
            }
        }

        // Re-sort after recency boost
        if recency_cutoff.is_some() {
            search_results.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        Ok(search_results)
    }

    fn doc_to_result(
        &self,
        searcher: &Searcher,
        doc_address: DocAddress,
        score: f64,
        query_terms: &[&str],
    ) -> Result<SearchResult, IndexError> {
        let doc: tantivy::TantivyDocument = searcher.doc(doc_address)?;

        let path = doc
            .get_first(self.fields.path)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let basename = doc
            .get_first(self.fields.basename)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let display_title = doc
            .get_first(self.fields.display_title)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let content = doc
            .get_first(self.fields.content)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let mtime = doc
            .get_first(self.fields.mtime)
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // Extract tags from stored JSON
        let tags: Vec<String> = doc
            .get_first(self.fields.tags_stored)
            .and_then(|v| v.as_object())
            .and_then(|obj| {
                obj.into_iter()
                    .find(|(k, _)| *k == "tags")
                    .and_then(|(_, v)| v.as_array())
                    .map(|arr| {
                        arr.into_iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                            .collect()
                    })
            })
            .unwrap_or_default();

        let matched_terms: Vec<String> = query_terms.iter().map(|t| t.to_lowercase()).collect();

        Ok(SearchResult {
            path,
            score,
            matched_terms,
            basename,
            display_title,
            content,
            mtime,
            tags,
        })
    }
}

/// Determine fuzzy edit distance based on term length and fuzziness level
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

fn get_boost_for_field(field_name: &str, boosts: &crate::types::FieldBoosts) -> f32 {
    match field_name {
        "basename" => boosts.basename,
        "display_title" => boosts.display_title,
        "aliases" => boosts.aliases,
        "directory" => boosts.directory,
        "content" => boosts.content,
        "headings1" => boosts.headings1,
        "headings2" => boosts.headings2,
        "headings3" => boosts.headings3,
        "tags_text" => boosts.tags_text,
        "unmarked_tags" => boosts.unmarked_tags,
        _ => 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DocumentInput, IndexConfig, SearchOptions};

    fn make_doc(path: &str, basename: &str, content: &str) -> DocumentInput {
        DocumentInput {
            path: path.to_string(),
            basename: basename.to_string(),
            display_title: String::new(),
            aliases: String::new(),
            content: content.to_string(),
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
    fn test_basic_search() {
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
    fn test_multi_term_search() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "The quick brown fox jumps over the lazy dog"),
            make_doc("b.md", "b", "The quick rabbit runs fast"),
        ]);

        let results = mgr.search("quick fox", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn test_empty_query() {
        let mgr = setup_index(vec![make_doc("a.md", "a", "content")]);
        let results = mgr.search("", &SearchOptions::default()).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_single_file_filter() {
        let mgr = setup_index(vec![
            make_doc("a.md", "a", "hello world"),
            make_doc("b.md", "b", "hello world"),
        ]);

        let opts = SearchOptions {
            single_file_path: Some("a.md".to_string()),
            ..Default::default()
        };

        let results = mgr.search("hello", &opts).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
    }

    #[test]
    fn test_basename_boost() {
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
        // "rust.md" should score higher because basename matches with high boost
        assert_eq!(results[0].path, "notes/rust.md");
    }

    #[test]
    fn test_fuzzy_search() {
        let mgr = setup_index(vec![make_doc(
            "a.md",
            "a",
            "The restaurant serves excellent cuisine",
        )]);

        let opts = SearchOptions {
            fuzziness: "2".to_string(),
            ..Default::default()
        };

        let results = mgr.search("restaurnt", &opts).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn test_tags_in_result() {
        let mgr = setup_index(vec![{
            let mut doc = make_doc("a.md", "a", "content");
            doc.tags = vec!["#rust".to_string(), "#programming".to_string()];
            doc
        }]);

        let results = mgr.search("content", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].tags, vec!["#rust", "#programming"]);
    }

    #[test]
    fn test_search_returns_stored_fields() {
        let mgr = setup_index(vec![{
            let mut doc = make_doc("notes/test.md", "test", "Hello world content");
            doc.display_title = "Test Note".to_string();
            doc.mtime = 12345;
            doc
        }]);

        let results = mgr.search("hello", &SearchOptions::default()).unwrap();
        assert!(!results.is_empty());
        let r = &results[0];
        assert_eq!(r.path, "notes/test.md");
        assert_eq!(r.basename, "test");
        assert_eq!(r.display_title, "Test Note");
        assert_eq!(r.content, "Hello world content");
        assert_eq!(r.mtime, 12345);
    }

    #[test]
    fn test_fuzzy_distance() {
        assert_eq!(fuzzy_distance("ab", 0.2), 0);
        assert_eq!(fuzzy_distance("abc", 0.2), 0);
        assert_eq!(fuzzy_distance("abcd", 0.2), 1); // 4-5 chars = 1 at 0.1+
        assert_eq!(fuzzy_distance("abcd", 0.1), 1);
        assert_eq!(fuzzy_distance("abcdef", 0.2), 2);
        assert_eq!(fuzzy_distance("abcdef", 0.1), 1);
        assert_eq!(fuzzy_distance("abcdef", 0.0), 0);
    }
}
