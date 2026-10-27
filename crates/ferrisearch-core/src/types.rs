use miniserde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInput {
    pub path: String,
    pub basename: String,
    #[serde(rename = "displayTitle")]
    pub display_title: String,
    pub aliases: String,
    pub content: String,
    pub headings: String,
    pub tags: Vec<String>,
    #[serde(rename = "unmarkedTags")]
    pub unmarked_tags: Vec<String>,
    /// Modification time as Unix epoch milliseconds.
    pub mtime: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchInfo {
    #[serde(rename = "matchText")]
    pub match_text: String,
    /// UTF-16 code unit offset (for JavaScript string indexing)
    pub offset: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FieldScoreBreakdown {
    #[serde(rename = "displayTitle")]
    pub display_title: f64,
    pub directory: f64,
    pub content: f64,
    pub headings: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub score: f64,
    #[serde(rename = "recencyMultiplier")]
    pub recency_multiplier: f64,
    #[serde(rename = "fieldScores")]
    pub field_scores: Option<FieldScoreBreakdown>,
    #[serde(rename = "matchedTerms")]
    pub matched_terms: Vec<String>,
    pub basename: String,
    #[serde(rename = "displayTitle")]
    pub display_title: String,
    pub content: String,
    pub mtime: f64,
    pub tags: Vec<String>,
    pub matches: Vec<MatchInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConfig {
    #[serde(rename = "ignoreDiacritics")]
    pub ignore_diacritics: bool,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            ignore_diacritics: true,
        }
    }
}

/// Partial wire form of [`IndexConfig`]: every field is optional so callers
/// may send `{}` or omit the config entirely.
#[derive(Debug, Clone, Deserialize)]
pub struct PartialIndexConfig {
    #[serde(rename = "ignoreDiacritics")]
    pub ignore_diacritics: Option<bool>,
}

impl From<PartialIndexConfig> for IndexConfig {
    fn from(partial: PartialIndexConfig) -> Self {
        Self {
            ignore_diacritics: partial.ignore_diacritics.unwrap_or(true),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    #[serde(rename = "fieldBoosts")]
    pub field_boosts: FieldBoosts,
    pub fuzziness: String,
    #[serde(rename = "prefixLength")]
    pub prefix_length: f64,
    pub limit: f64,
    #[serde(rename = "singleFilePath")]
    pub single_file_path: Option<String>,
    #[serde(rename = "recencyBoost")]
    pub recency_boost: String,
    #[serde(rename = "scoreBreakdown")]
    pub score_breakdown: bool,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            field_boosts: <FieldBoosts as Default>::default(),
            fuzziness: "1".into(),
            prefix_length: 1.0,
            limit: 10.0,
            single_file_path: None,
            recency_boost: "0".into(),
            score_breakdown: false,
        }
    }
}

/// Partial wire form of [`SearchOptions`]: callers routinely send only the
/// fields they set, so every field is optional here.
#[derive(Debug, Clone, Deserialize)]
pub struct PartialSearchOptions {
    #[serde(rename = "fieldBoosts")]
    pub field_boosts: Option<PartialFieldBoosts>,
    pub fuzziness: Option<String>,
    #[serde(rename = "prefixLength")]
    pub prefix_length: Option<f64>,
    pub limit: Option<f64>,
    #[serde(rename = "singleFilePath")]
    pub single_file_path: Option<String>,
    #[serde(rename = "recencyBoost")]
    pub recency_boost: Option<String>,
    #[serde(rename = "scoreBreakdown")]
    pub score_breakdown: Option<bool>,
}

impl From<PartialSearchOptions> for SearchOptions {
    fn from(partial: PartialSearchOptions) -> Self {
        let defaults = <SearchOptions as Default>::default();
        Self {
            field_boosts: partial.field_boosts.map(FieldBoosts::from).unwrap_or_default(),
            fuzziness: partial.fuzziness.unwrap_or(defaults.fuzziness),
            prefix_length: partial.prefix_length.unwrap_or(defaults.prefix_length),
            limit: partial.limit.unwrap_or(defaults.limit),
            single_file_path: partial.single_file_path,
            recency_boost: partial.recency_boost.unwrap_or(defaults.recency_boost),
            score_breakdown: partial.score_breakdown.unwrap_or(defaults.score_breakdown),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldBoosts {
    pub basename: f32,
    #[serde(rename = "displayTitle")]
    pub display_title: f32,
    pub aliases: f32,
    pub directory: f32,
    pub content: f32,
    pub headings: f32,
    #[serde(rename = "tagsText")]
    pub tags_text: f32,
    #[serde(rename = "unmarkedTags")]
    pub unmarked_tags: f32,
}

impl Default for FieldBoosts {
    fn default() -> Self {
        Self {
            basename: 10.0,
            display_title: 10.0,
            aliases: 10.0,
            directory: 7.0,
            headings: 5.0,
            tags_text: 2.0,
            unmarked_tags: 2.0,
            content: 1.0,
        }
    }
}

/// Partial wire form of [`FieldBoosts`].
#[derive(Debug, Clone, Deserialize)]
pub struct PartialFieldBoosts {
    pub basename: Option<f32>,
    #[serde(rename = "displayTitle")]
    pub display_title: Option<f32>,
    pub aliases: Option<f32>,
    pub directory: Option<f32>,
    pub content: Option<f32>,
    pub headings: Option<f32>,
    #[serde(rename = "tagsText")]
    pub tags_text: Option<f32>,
    #[serde(rename = "unmarkedTags")]
    pub unmarked_tags: Option<f32>,
}

impl From<PartialFieldBoosts> for FieldBoosts {
    fn from(partial: PartialFieldBoosts) -> Self {
        let defaults = <FieldBoosts as Default>::default();
        Self {
            basename: partial.basename.unwrap_or(defaults.basename),
            display_title: partial.display_title.unwrap_or(defaults.display_title),
            aliases: partial.aliases.unwrap_or(defaults.aliases),
            directory: partial.directory.unwrap_or(defaults.directory),
            content: partial.content.unwrap_or(defaults.content),
            headings: partial.headings.unwrap_or(defaults.headings),
            tags_text: partial.tags_text.unwrap_or(defaults.tags_text),
            unmarked_tags: partial.unmarked_tags.unwrap_or(defaults.unmarked_tags),
        }
    }
}

impl FieldBoosts {
    pub fn for_field(&self, name: &str) -> f32 {
        match name {
            "basename" => self.basename,
            "display_title" => self.display_title,
            "aliases" => self.aliases,
            "directory" => self.directory,
            "content" => self.content,
            "headings" => self.headings,
            "tags_text" => self.tags_text,
            "unmarked_tags" => self.unmarked_tags,
            _ => 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miniserde::json;

    fn test_boosts() -> FieldBoosts {
        FieldBoosts {
            basename: 2.0,
            display_title: 3.0,
            aliases: 4.0,
            directory: 5.0,
            content: 6.0,
            headings: 7.0,
            tags_text: 8.0,
            unmarked_tags: 9.0,
        }
    }

    #[test]
    fn test_index_config_partial() {
        let config: IndexConfig =
            json::from_str::<PartialIndexConfig>(r#"{"ignoreDiacritics": false}"#)
                .map(IndexConfig::from)
                .unwrap();
        assert!(!config.ignore_diacritics);

        let defaulted: IndexConfig = json::from_str::<PartialIndexConfig>(r#"{}"#)
            .map(IndexConfig::from)
            .unwrap();
        assert!(defaulted.ignore_diacritics);
    }

    #[test]
    fn test_search_options_partial() {
        let opts: SearchOptions = json::from_str::<PartialSearchOptions>(
            r#"{"fuzziness": "2", "limit": 10}"#,
        )
        .map(SearchOptions::from)
        .unwrap();
        assert_eq!(opts.fuzziness, "2");
        assert_eq!(opts.limit, 10.0);
        assert_eq!(opts.prefix_length, 1.0);
        assert_eq!(opts.single_file_path, None);
        assert_eq!(opts.recency_boost, "0");
        assert!(!opts.score_breakdown);
    }

    #[test]
    fn test_field_boosts_partial() {
        let boosts: FieldBoosts = json::from_str::<PartialFieldBoosts>(
            r#"{"basename": 20.0, "content": 5.0}"#,
        )
        .map(FieldBoosts::from)
        .unwrap();
        assert_eq!(boosts.basename, 20.0);
        assert_eq!(boosts.content, 5.0);
        assert_eq!(boosts.display_title, 10.0);
    }

    #[test]
    fn test_document_wire_format_round_trip() {
        let doc = DocumentInput {
            path: "notes/test.md".into(),
            basename: "test".into(),
            display_title: "Test".into(),
            aliases: String::new(),
            content: "hello".into(),
            headings: String::new(),
            tags: vec!["#a".into()],
            unmarked_tags: vec![],
            mtime: 1000.0,
        };
        let text = json::to_string(&doc);
        assert!(text.contains(r#""displayTitle":"Test""#));
        assert!(text.contains(r#""unmarkedTags":[]"#));
        let back: DocumentInput = json::from_str(&text).unwrap();
        assert_eq!(back.path, doc.path);
        assert_eq!(back.display_title, doc.display_title);
        assert_eq!(back.mtime, doc.mtime);
    }

    #[test]
    fn test_search_result_wire_format() {
        let result = SearchResult {
            path: "a.md".into(),
            score: 1.5,
            recency_multiplier: 1.0,
            field_scores: None,
            matched_terms: vec!["needle".into()],
            basename: "a".into(),
            display_title: "A".into(),
            content: "needle here".into(),
            mtime: 1000.0,
            tags: vec![],
            matches: vec![MatchInfo {
                match_text: "needle".into(),
                offset: 0,
            }],
        };
        let text = json::to_string(&result);
        assert!(text.contains(r#""recencyMultiplier":1"#));
        assert!(text.contains(r#""fieldScores":null"#));
        assert!(text.contains(r#""matchedTerms":["needle"]"#));
        assert!(text.contains(r#""matchText":"needle""#));
    }

    #[test]
    fn test_field_boosts_for_field() {
        let boosts = test_boosts();
        assert_eq!(boosts.for_field("basename"), 2.0);
        assert_eq!(boosts.for_field("headings"), 7.0);
        assert_eq!(boosts.for_field("content"), 6.0);
        assert_eq!(boosts.for_field("unknown"), 1.0);
    }
}
