use napi::bindgen_prelude::*;
use napi_derive::napi;

use ferrisearch_core::index::IndexManager;
use ferrisearch_core::types;

/// A document to be indexed. Maps to a single Obsidian note.
///
/// **Searched fields** (queries match against these via exact, prefix, and fuzzy):
///   `display_title`, `directory` (derived from path), `content`, `headings`
///
/// **Indexed but not searched** (stored for retrieval/filtering, not matched by queries):
///   `basename`, `aliases`, `tags`, `unmarked_tags`
#[napi(object)]
#[derive(Debug, Clone)]
pub struct DocumentInput {
    /// Full vault-relative path including extension, e.g. "notes/sub/my-note.md".
    /// Used as the unique document key for upsert/delete. Also used to derive the
    /// `directory` search field (everything before the last `/`).
    pub path: String,
    /// Filename without extension, e.g. "my-note". Indexed and stored but not searched.
    pub basename: String,
    /// User-facing title from frontmatter `title:` field, or the basename if absent.
    /// Searched with high boost (10x).
    pub display_title: String,
    /// Alternative names from frontmatter `aliases:` field, space-separated.
    /// Indexed but not currently searched by default.
    pub aliases: String,
    /// Full markdown body of the note (without frontmatter). Primary search field.
    pub content: String,
    /// Space-joined headings from all levels (H1-H3). Searched with 5x boost.
    pub headings: String,
    /// Obsidian tags from frontmatter and inline `#tag` syntax, e.g. ["#rust", "#code"].
    /// Stored as JSON for post-search retrieval. Indexed as text but not searched by default.
    pub tags: Vec<String>,
    /// Tags inferred from note content that aren't explicit `#tag` syntax.
    /// Indexed as text but not searched by default.
    pub unmarked_tags: Vec<String>,
    /// Last modification time as Unix epoch milliseconds. Used for recency boosting.
    pub mtime: f64,
}

impl From<DocumentInput> for types::DocumentInput {
    fn from(d: DocumentInput) -> Self {
        Self {
            path: d.path,
            basename: d.basename,
            display_title: d.display_title,
            aliases: d.aliases,
            content: d.content,
            headings: d.headings,
            tags: d.tags,
            unmarked_tags: d.unmarked_tags,
            mtime: d.mtime as u64,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct IndexConfig {
    pub ignore_diacritics: Option<bool>,
}

impl From<IndexConfig> for types::IndexConfig {
    fn from(c: IndexConfig) -> Self {
        Self {
            ignore_diacritics: c.ignore_diacritics.unwrap_or(true),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct FieldBoosts {
    pub basename: Option<f64>,
    pub display_title: Option<f64>,
    pub aliases: Option<f64>,
    pub directory: Option<f64>,
    pub headings: Option<f64>,
    pub tags_text: Option<f64>,
    pub unmarked_tags: Option<f64>,
    pub content: Option<f64>,
}

impl From<FieldBoosts> for types::FieldBoosts {
    fn from(b: FieldBoosts) -> Self {
        let d = types::FieldBoosts::default();
        Self {
            basename: b.basename.map_or(d.basename, |v| v as f32),
            display_title: b.display_title.map_or(d.display_title, |v| v as f32),
            aliases: b.aliases.map_or(d.aliases, |v| v as f32),
            directory: b.directory.map_or(d.directory, |v| v as f32),
            headings: b.headings.map_or(d.headings, |v| v as f32),
            tags_text: b.tags_text.map_or(d.tags_text, |v| v as f32),
            unmarked_tags: b.unmarked_tags.map_or(d.unmarked_tags, |v| v as f32),
            content: b.content.map_or(d.content, |v| v as f32),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub field_boosts: Option<FieldBoosts>,
    pub fuzziness: Option<String>,
    pub prefix_length: Option<u32>,
    pub limit: Option<u32>,
    pub single_file_path: Option<String>,
    pub recency_boost: Option<String>,
}

impl From<SearchOptions> for types::SearchOptions {
    fn from(o: SearchOptions) -> Self {
        Self {
            field_boosts: o.field_boosts.map(Into::into).unwrap_or_default(),
            fuzziness: o.fuzziness.unwrap_or_else(|| "1".into()),
            prefix_length: o.prefix_length.unwrap_or(1) as usize,
            limit: o.limit.unwrap_or(10) as usize,
            single_file_path: o.single_file_path,
            recency_boost: o.recency_boost.unwrap_or_else(|| "0".into()),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub path: String,
    pub score: f64,
    pub matched_terms: Vec<String>,
    pub basename: String,
    pub display_title: String,
    pub content: String,
    pub mtime: f64,
    pub tags: Vec<String>,
}

impl From<types::SearchResult> for SearchResult {
    fn from(r: types::SearchResult) -> Self {
        Self {
            path: r.path,
            score: r.score,
            matched_terms: r.matched_terms,
            basename: r.basename,
            display_title: r.display_title,
            content: r.content,
            mtime: r.mtime as f64,
            tags: r.tags,
        }
    }
}

#[napi]
pub struct SearchIndex {
    inner: Option<IndexManager>,
}

impl SearchIndex {
    fn inner(&self) -> Result<&IndexManager> {
        self.inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("Index is closed"))
    }

    fn inner_mut(&mut self) -> Result<&mut IndexManager> {
        self.inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Index is closed"))
    }
}

fn map_err(e: ferrisearch_core::index::IndexError) -> Error {
    Error::from_reason(e.to_string())
}

#[napi]
impl SearchIndex {
    #[napi(constructor)]
    pub fn new(index_path: String, config: Option<IndexConfig>) -> Result<Self> {
        let cfg = config.map(Into::into).unwrap_or_default();
        let inner = IndexManager::new(&index_path, cfg).map_err(map_err)?;
        Ok(Self { inner: Some(inner) })
    }

    #[napi]
    pub fn close(&mut self) -> Result<()> {
        self.inner = None;
        Ok(())
    }

    #[napi]
    pub fn add_documents(&mut self, docs: Vec<DocumentInput>) -> Result<()> {
        let core_docs: Vec<types::DocumentInput> = docs.into_iter().map(Into::into).collect();
        self.inner_mut()?.add_documents(&core_docs).map_err(map_err)
    }

    #[napi]
    pub fn remove_documents(&mut self, paths: Vec<String>) -> Result<()> {
        self.inner_mut()?.remove_documents(&paths);
        Ok(())
    }

    #[napi]
    pub fn commit(&mut self) -> Result<()> {
        self.inner_mut()?.commit().map_err(map_err)
    }

    #[napi]
    pub fn warm_up(&self) -> Result<()> {
        self.inner()?.warm_up().map_err(map_err)
    }

    #[napi]
    pub fn has_document(&self, path: String) -> Result<bool> {
        self.inner()?.has_document(&path).map_err(map_err)
    }

    #[napi]
    pub fn document_count(&self) -> Result<f64> {
        self.inner()?
            .document_count()
            .map(|c| c as f64)
            .map_err(map_err)
    }

    #[napi]
    pub fn search(
        &self,
        query: String,
        options: Option<SearchOptions>,
    ) -> Result<Vec<SearchResult>> {
        let opts = options.map(Into::into).unwrap_or_default();
        let results = self.inner()?.search(&query, &opts).map_err(map_err)?;
        Ok(results.into_iter().map(Into::into).collect())
    }
}
