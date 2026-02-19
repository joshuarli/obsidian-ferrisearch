use serde::{Deserialize, Serialize};

/// Input document to be indexed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInput {
    pub path: String,
    pub basename: String,
    pub display_title: String,
    pub aliases: String,
    pub content: String,
    pub headings1: String,
    pub headings2: String,
    pub headings3: String,
    pub tags: Vec<String>,
    pub unmarked_tags: Vec<String>,
    pub mtime: u64,
}

/// Search result returned from a query
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

/// Configuration for the index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConfig {
    #[serde(default = "default_true")]
    pub ignore_diacritics: bool,
    #[serde(default = "default_false")]
    pub ignore_arabic_diacritics: bool,
}

fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            ignore_diacritics: true,
            ignore_arabic_diacritics: false,
        }
    }
}

/// Options for a search query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    /// Per-field boost multipliers
    #[serde(default = "default_field_boosts")]
    pub field_boosts: FieldBoosts,
    /// Fuzziness level: "0", "1", or "2"
    #[serde(default = "default_fuzziness")]
    pub fuzziness: String,
    /// Minimum term length for prefix matching
    #[serde(default = "default_prefix_length")]
    pub prefix_length: usize,
    /// Max results to return
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// If set, only search within this file
    #[serde(default)]
    pub single_file_path: Option<String>,
    /// Recency boost: "0" disabled, "1" day, "2" week, "3" month
    #[serde(default = "default_recency_boost")]
    pub recency_boost: String,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            field_boosts: default_field_boosts(),
            fuzziness: default_fuzziness(),
            prefix_length: default_prefix_length(),
            limit: default_limit(),
            single_file_path: None,
            recency_boost: default_recency_boost(),
        }
    }
}

fn default_fuzziness() -> String {
    "1".to_string()
}
fn default_prefix_length() -> usize {
    1
}
fn default_limit() -> usize {
    50
}
fn default_recency_boost() -> String {
    "0".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldBoosts {
    #[serde(default = "default_basename_boost")]
    pub basename: f32,
    #[serde(default = "default_basename_boost")]
    pub display_title: f32,
    #[serde(default = "default_basename_boost")]
    pub aliases: f32,
    #[serde(default = "default_directory_boost")]
    pub directory: f32,
    #[serde(default = "default_h1_boost")]
    pub headings1: f32,
    #[serde(default = "default_h2_boost")]
    pub headings2: f32,
    #[serde(default = "default_h3_boost")]
    pub headings3: f32,
    #[serde(default = "default_tags_boost")]
    pub tags_text: f32,
    #[serde(default = "default_tags_boost")]
    pub unmarked_tags: f32,
    #[serde(default = "default_content_boost")]
    pub content: f32,
}

fn default_basename_boost() -> f32 {
    10.0
}
fn default_directory_boost() -> f32 {
    7.0
}
fn default_h1_boost() -> f32 {
    6.0
}
fn default_h2_boost() -> f32 {
    5.0
}
fn default_h3_boost() -> f32 {
    4.0
}
fn default_tags_boost() -> f32 {
    2.0
}
fn default_content_boost() -> f32 {
    1.0
}

fn default_field_boosts() -> FieldBoosts {
    FieldBoosts {
        basename: default_basename_boost(),
        display_title: default_basename_boost(),
        aliases: default_basename_boost(),
        directory: default_directory_boost(),
        headings1: default_h1_boost(),
        headings2: default_h2_boost(),
        headings3: default_h3_boost(),
        tags_text: default_tags_boost(),
        unmarked_tags: default_tags_boost(),
        content: default_content_boost(),
    }
}
