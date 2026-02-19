use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInput {
    pub path: String,
    pub basename: String,
    pub display_title: String,
    pub aliases: String,
    pub content: String,
    pub headings: String,
    pub tags: Vec<String>,
    pub unmarked_tags: Vec<String>,
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub score: f64,
    pub matched_terms: Vec<String>,
    pub basename: String,
    pub display_title: String,
    pub content: String,
    pub mtime: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct IndexConfig {
    pub ignore_diacritics: bool,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            ignore_diacritics: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SearchOptions {
    pub field_boosts: FieldBoosts,
    pub fuzziness: String,
    pub prefix_length: usize,
    pub limit: usize,
    pub single_file_path: Option<String>,
    pub recency_boost: String,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            field_boosts: FieldBoosts::default(),
            fuzziness: "1".into(),
            prefix_length: 1,
            limit: 10,
            single_file_path: None,
            recency_boost: "0".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct FieldBoosts {
    pub basename: f32,
    pub display_title: f32,
    pub aliases: f32,
    pub directory: f32,
    pub headings: f32,
    pub tags_text: f32,
    pub unmarked_tags: f32,
    pub content: f32,
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

    #[test]
    fn test_index_config_serde_override() {
        let config: IndexConfig = serde_json::from_str(r#"{"ignore_diacritics": false}"#).unwrap();
        assert!(!config.ignore_diacritics);
    }

    #[test]
    fn test_search_options_serde_partial() {
        let opts: SearchOptions =
            serde_json::from_str(r#"{"fuzziness": "2", "limit": 10}"#).unwrap();
        assert_eq!(opts.fuzziness, "2");
        assert_eq!(opts.limit, 10);
        assert_eq!(opts.prefix_length, 1);
    }

    #[test]
    fn test_field_boosts_serde_partial() {
        let boosts: FieldBoosts =
            serde_json::from_str(r#"{"basename": 20.0, "content": 5.0}"#).unwrap();
        assert_eq!(boosts.basename, 20.0);
        assert_eq!(boosts.content, 5.0);
        assert_eq!(boosts.display_title, 10.0);
    }

    #[test]
    fn test_field_boosts_for_field() {
        let boosts = FieldBoosts::default();
        assert_eq!(boosts.for_field("basename"), 10.0);
        assert_eq!(boosts.for_field("headings"), 5.0);
        assert_eq!(boosts.for_field("content"), 1.0);
        assert_eq!(boosts.for_field("unknown"), 1.0);
    }
}
